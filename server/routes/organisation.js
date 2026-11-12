import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Invitation, Organisation, Project, User } from '../models/index.js';
import { ORGANISATION_NAME_MAX, formatJoinCode } from '../../src/lib/organisation.js';
import { INVITATION_LIST_LIMIT, generateInvitationToken, invitationExpiry, invitationPath, invitationState } from '../../src/lib/invitations.js';
import { projectRoleOf } from '../../src/lib/permissions.js';
import { isAdmin } from '../services/access.js';
import { uniqueJoinCode } from '../services/organisation.js';
import { accountExists, hashInvitationToken, invitationDto } from '../services/invitations.js';
import { getProjectSummaries } from '../services/task-aggregates.js';
import { HttpError } from '../utils/http-error.js';
import { normalizeEmail, readEmail, readString, requireObject } from '../utils/validation.js';

const OVERVIEW_LIMIT = 200;

/**
 * The organisation page: who it is, how many people and projects it has, and how each project
 * is doing. Members see the projects they are in plus the open ones; Admins see every project.
 * The invite code is only ever sent to Admins.
 */
export function createOrganisationRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  async function organisationDto(user) {
    const organisation = await Organisation.findById(user.organisationId).lean();
    if (!organisation) throw new HttpError(404, 'NOT_FOUND', 'Organisation not found.');
    const [memberCount, projectCount] = await Promise.all([
      User.countDocuments({ organisationId: user.organisationId, deactivatedAt: null }),
      Project.countDocuments({ organisationId: user.organisationId }),
    ]);
    return {
      id: String(organisation._id),
      name: organisation.name,
      projectCreation: organisation.projectCreation,
      createdAt: organisation.createdAt,
      memberCount,
      // Members only need to know how many projects they can see; Admins get the real total.
      projectCount: isAdmin(user) ? projectCount : undefined,
      ...(isAdmin(user) ? { joinCode: formatJoinCode(organisation.joinCode) } : {}),
    };
  }

  router.get('/', requireAuth, async (request, response) => {
    response.json(await organisationDto(request.user));
  });

  router.patch('/', requireAuth, async (request, response) => {
    if (!isAdmin(request.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can edit the organisation.');
    const body = requireObject(request.body);
    const name = readString(body, 'name', { max: ORGANISATION_NAME_MAX, label: 'Organisation name' });
    const updated = await Organisation.findOneAndUpdate(
      { _id: request.user.organisationId },
      { $set: { name } },
      { returnDocument: 'before', projection: { name: 1 } },
    ).lean();
    if (!updated) throw new HttpError(404, 'NOT_FOUND', 'Organisation not found.');
    if (updated.name !== name) response.locals.auditChange = { field: 'organisationName', from: updated.name, to: name };
    response.json(await organisationDto(request.user));
  });

  // Rotating ends the old code at once. People already in the organisation are unaffected.
  router.post('/join-code', requireAuth, async (request, response) => {
    if (!isAdmin(request.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can change the invite code.');
    const joinCode = await uniqueJoinCode();
    await Organisation.updateOne({ _id: request.user.organisationId }, { $set: { joinCode } });
    // The codes themselves are credentials, so the audit record only says that it rotated.
    response.locals.auditChange = { field: 'joinCode', from: 'previous', to: 'rotated' };
    response.json(await organisationDto(request.user));
  });

  // ---------- Personal invitation links (issue #78): Admins only ----------
  const requireAdmin = (user, action) => {
    if (!isAdmin(user)) throw new HttpError(403, 'FORBIDDEN', `Only an admin can ${action} invitation links.`);
  };
  async function creatorNames(invitations) {
    const ids = [...new Set(invitations.map((invitation) => invitation.createdById).filter(Boolean))];
    const users = ids.length ? await User.find({ _id: { $in: ids } }).select('_id name').lean() : [];
    return new Map(users.map((user) => [String(user._id), user.name]));
  }

  router.get('/invitations', requireAuth, async (request, response) => {
    requireAdmin(request.user, 'see');
    const invitations = await Invitation.find({ organisationId: request.user.organisationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(INVITATION_LIST_LIMIT)
      .lean();
    const timestamp = now();
    const names = await creatorNames(invitations);
    response.json(invitations.map((invitation) => invitationDto(invitation, timestamp, names)));
  });

  // The response is the only time the link's secret leaves the server.
  router.post('/invitations', requireAuth, async (request, response) => {
    requireAdmin(request.user, 'create');
    const email = readEmail(requireObject(request.body));
    const emailNormalized = normalizeEmail(email);
    if (await accountExists(email)) {
      throw new HttpError(409, 'DUPLICATE_EMAIL', 'There is already an account with this email.', {
        email: 'There is already an account with this email. Add them to projects from the project members page.',
      });
    }
    const timestamp = now();
    // One live link per address: a new link replaces the old one, which stops working.
    await Invitation.updateMany(
      { organisationId: request.user.organisationId, emailNormalized, acceptedAt: null, revokedAt: null, expiresAt: { $gt: timestamp } },
      { $set: { revokedAt: timestamp } },
    );
    const token = generateInvitationToken();
    const invitation = await Invitation.create({
      organisationId: request.user.organisationId,
      email,
      emailNormalized,
      tokenHash: hashInvitationToken(token),
      createdById: request.user.id,
      expiresAt: invitationExpiry(timestamp),
    });
    response.locals.auditChange = { field: 'invitation', from: null, to: 'created' };
    response.status(201).json({
      ...invitationDto(invitation.toObject(), timestamp, new Map([[request.user.id, request.authUser.name]])),
      token,
      path: invitationPath(token),
    });
  });

  router.delete('/invitations/:invitationId', requireAuth, async (request, response) => {
    requireAdmin(request.user, 'revoke');
    const filter = { _id: request.params.invitationId, organisationId: request.user.organisationId };
    const invitation = await Invitation.findOne(filter).lean();
    if (!invitation) throw new HttpError(404, 'NOT_FOUND', 'Invitation not found.');
    const timestamp = now();
    if (invitationState(invitation, timestamp) === 'accepted') {
      throw new HttpError(409, 'INVITATION_USED', 'This invitation has already been used, so there is nothing to revoke.');
    }
    // Revoking twice (or revoking an expired link) is harmless and keeps the first time.
    const revoked = invitation.revokedAt
      ? invitation
      : await Invitation.findOneAndUpdate({ ...filter, acceptedAt: null }, { $set: { revokedAt: timestamp } }, { returnDocument: 'after' }).lean();
    if (!revoked) throw new HttpError(409, 'INVITATION_USED', 'This invitation has already been used, so there is nothing to revoke.');
    if (!invitation.revokedAt) response.locals.auditChange = { field: 'invitation', from: 'pending', to: 'revoked' };
    response.json(invitationDto(revoked, timestamp, await creatorNames([revoked])));
  });

  router.get('/overview', requireAuth, async (request, response) => {
    const { organisationId, id: userId } = request.user;
    const filter = isAdmin(request.user)
      ? { organisationId }
      : { organisationId, $or: [{ memberIds: userId }, { visibility: 'open' }] };
    const projects = await Project.find(filter)
      .select('_id name description visibility ownerId memberIds managerIds viewerIds updatedAt')
      .sort({ name: 1, _id: 1 })
      .limit(OVERVIEW_LIMIT)
      .lean();
    const [summaries, owners, people] = await Promise.all([
      getProjectSummaries(projects.map((project) => String(project._id)), now, request.query.today),
      User.find({ _id: { $in: [...new Set(projects.map((project) => String(project.ownerId)))] } }).select('_id name').lean(),
      User.countDocuments({ organisationId, deactivatedAt: null }),
    ]);
    const summariesById = new Map(summaries.map((summary) => [summary.projectId, summary]));
    const ownerNames = new Map(owners.map((owner) => [String(owner._id), owner.name]));

    const rows = projects.map((project) => {
      const id = String(project._id);
      const summary = summariesById.get(id);
      return {
        id,
        name: project.name,
        description: project.description,
        visibility: project.visibility ?? 'private',
        ownerName: ownerNames.get(String(project.ownerId)) ?? null,
        memberCount: project.memberIds.length,
        yourRole: projectRoleOf(project, userId),
        updatedAt: project.updatedAt,
        total: summary.total,
        counts: summary.counts,
        overdue: summary.overdue,
      };
    });
    const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
    response.json({
      projects: rows,
      totals: {
        people,
        projects: rows.length,
        tasks: sum((row) => row.total),
        done: sum((row) => row.counts.Done),
        overdue: sum((row) => row.overdue),
      },
    });
  });

  return router;
}
