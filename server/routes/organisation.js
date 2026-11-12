import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Organisation, Project, User } from '../models/index.js';
import { ORGANISATION_NAME_MAX, formatJoinCode } from '../../src/lib/organisation.js';
import { projectRoleOf } from '../../src/lib/permissions.js';
import { isAdmin } from '../services/access.js';
import { uniqueJoinCode } from '../services/organisation.js';
import { getProjectSummaries } from '../services/task-aggregates.js';
import { HttpError } from '../utils/http-error.js';
import { readString, requireObject } from '../utils/validation.js';

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
