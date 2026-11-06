import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Comment, Notification, Project, Task, User } from '../models/index.js';
import {
  GRANTABLE_PROJECT_ROLES,
  PROJECT_ROLES,
  PROJECT_VISIBILITIES,
  memberRemovalError,
  memberRoleChangeError,
  projectRoleOf,
  rolesForNewMember,
  withMemberRole,
  withoutMember,
} from '../../src/lib/permissions.js';
import { PROJECT_ACCESS_FIELDS, forbidden, getProjectForUser, isAdmin, requireProjectCreator } from '../services/access.js';
import { projectDto, projectDtos, projectMembers } from '../utils/dto.js';
import { HttpError } from '../utils/http-error.js';
import { readListOptions } from '../utils/pagination.js';
import { getProjectSummaries } from '../services/task-aggregates.js';
import { escapeRegex, normalizeEmail, readEmail, readEnum, readId, readString, requireObject } from '../utils/validation.js';

export function createProjectsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/projects', requireAuth, async (request, response) => {
    const filter = isAdmin(request.user) ? {} : { memberIds: request.user.id };
    const options = readListOptions(request.query);
    const projects = await Project.find(filter)
      .select(PROJECT_ACCESS_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();
    response.json(await projectDtos(projects));
  });

  // Open projects the caller is not in yet, for "Browse projects". Private projects never appear.
  router.get('/projects/directory', requireAuth, async (request, response) => {
    const q = typeof request.query.q === 'string' ? request.query.q.trim().slice(0, 80) : '';
    const filter = { visibility: 'open', memberIds: { $ne: request.user.id } };
    if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
    const projects = await Project.find(filter).select('_id name description ownerId memberIds').sort({ name: 1, _id: 1 }).limit(50).lean();
    const owners = await User.find({ _id: { $in: projects.map((project) => project.ownerId) } }).select('_id name').lean();
    const ownerNames = new Map(owners.map((owner) => [String(owner._id), owner.name]));
    response.json(projects.map((project) => ({
      id: String(project._id),
      name: project.name,
      description: project.description,
      ownerName: ownerNames.get(String(project.ownerId)) ?? null,
      memberCount: project.memberIds.length,
    })));
  });

  router.post('/projects', requireAuth, async (request, response) => {
    await requireProjectCreator(request.user);
    const body = requireObject(request.body);
    const name = readString(body, 'name', { max: 80, label: 'Project name' });
    const description = readString(body, 'description', { required: false, max: 2000, allowEmpty: true, label: 'Description' });
    const visibility = body.visibility === undefined ? 'private' : readEnum(body, 'visibility', PROJECT_VISIBILITIES, { label: 'Visibility' });
    const project = await Project.create({
      name,
      description: description ?? '',
      ownerId: request.user.id,
      memberIds: [request.user.id],
      managerIds: [],
      viewerIds: [],
      visibility,
    });
    response.status(201).json(await projectDto(project));
  });

  // Anyone may join an open project as a Member; joining twice is harmless.
  router.post('/projects/:projectId/join', requireAuth, async (request, response) => {
    const projectId = readId(request.params.projectId, 'Project');
    const project = await Project.findById(projectId).select('_id visibility memberIds').lean();
    if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
    const alreadyMember = project.memberIds.map(String).includes(request.user.id);
    if (!alreadyMember && project.visibility !== 'open') {
      throw forbidden('This project is private. Ask its owner or a manager to add you.');
    }
    if (!alreadyMember) {
      await Project.updateOne({ _id: projectId, visibility: 'open' }, { $addToSet: { memberIds: request.user.id } });
      response.locals.auditChange = { field: 'projectRole', from: null, to: 'Member' };
    }
    const joined = await Project.findById(projectId).select(PROJECT_ACCESS_FIELDS).lean();
    response.status(alreadyMember ? 200 : 201).json(await projectDto(joined));
  });

  router.get('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    response.json(await projectDto(project));
  });

  router.patch('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'project.edit' });
    const body = requireObject(request.body);
    const changes = {};
    if (body.name !== undefined) changes.name = readString(body, 'name', { max: 80, label: 'Project name' });
    if (body.description !== undefined) {
      changes.description = readString(body, 'description', { required: false, max: 2000, allowEmpty: true, label: 'Description' });
    }
    if (body.visibility !== undefined) changes.visibility = readEnum(body, 'visibility', PROJECT_VISIBILITIES, { label: 'Visibility' });
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a project field to update.');
    Object.assign(project, changes);
    await project.save();
    response.json(await projectDto(project));
  });

  router.delete('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'project.delete' });
    const tasks = await Task.find({ projectId: project.id }).select('_id');
    const taskIds = tasks.map((task) => task.id);
    await Promise.all([
      Comment.deleteMany({ taskId: { $in: taskIds } }),
      Notification.deleteMany({ $or: [{ projectId: project.id }, { taskId: { $in: taskIds } }] }),
      Task.deleteMany({ projectId: project.id }),
    ]);
    await project.deleteOne();
    response.status(204).end();
  });

  router.get('/projects/:projectId/members', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    response.json(await projectMembers(project));
  });

  router.post('/projects/:projectId/members', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'members.manage' });
    const body = requireObject(request.body);
    const email = readEmail(body);
    const role = body.role === undefined
      ? 'Member'
      : readEnum(body, 'role', GRANTABLE_PROJECT_ROLES, { label: 'Project role' });
    if (!rolesForNewMember(request.user, project).includes(role)) {
      throw forbidden('Only the project owner or an admin can add a manager.');
    }
    const user = await User.findOne({ emailNormalized: normalizeEmail(email) }).select('_id deactivatedAt');
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'No registered user has that email.', { email: 'Email is not registered.' });
    if (user.deactivatedAt) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'That account is deactivated.', { email: 'This account is deactivated.' });
    }
    // Adding an existing member is a no-op; their role changes through PATCH below.
    if (!project.memberIds.includes(user.id)) {
      Object.assign(project, withMemberRole(project, user.id, role));
      await project.save();
    }
    response.json(await projectMembers(project));
  });

  // Change a member's project role. role "Owner" transfers ownership; the old owner becomes a Manager.
  router.patch('/projects/:projectId/members/:userId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'members.manage' });
    const userId = readId(request.params.userId, 'User');
    const role = readEnum(requireObject(request.body), 'role', PROJECT_ROLES, { label: 'Project role' });
    const current = projectRoleOf(project, userId);
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Project member not found.');
    if (current === role) return response.json(await projectMembers(project));
    const reason = memberRoleChangeError(request.user, project, userId, role);
    if (reason) throw current === 'Owner' ? new HttpError(400, 'VALIDATION_ERROR', reason) : forbidden(reason);
    if (role === 'Owner' && await User.exists({ _id: userId, deactivatedAt: { $ne: null } })) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Ownership cannot go to a deactivated account.');
    }
    Object.assign(project, withMemberRole(project, userId, role));
    await project.save();
    // Viewers can't be assigned work, so a change to Viewer unassigns them.
    if (role === 'Viewer') {
      await Task.updateMany({ projectId: project.id, assigneeIds: userId }, { $pull: { assigneeIds: userId } });
    }
    response.locals.auditChange = { field: 'projectRole', from: current, to: role };
    response.json(await projectMembers(project));
  });

  // Owners, managers and admins remove people; any non-owner member may remove themselves (leave).
  router.delete('/projects/:projectId/members/:userId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId);
    const userId = readId(request.params.userId, 'User');
    const current = projectRoleOf(project, userId);
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Project member not found.');
    const reason = memberRemovalError(request.user, project, userId);
    if (reason) throw current === 'Owner' ? new HttpError(400, 'VALIDATION_ERROR', reason) : forbidden(reason);
    Object.assign(project, withoutMember(project, userId));
    await project.save();
    // Only touch tasks the user was assigned to (others keep their updatedAt), and drop the
    // user's notifications for this project: they name tasks the user can no longer open.
    await Promise.all([
      Task.updateMany({ projectId: project.id, assigneeIds: userId }, { $pull: { assigneeIds: userId } }),
      Notification.deleteMany({ projectId: project.id, userId }),
    ]);
    response.json(await projectMembers(project));
  });

  router.get('/projects/:projectId/summary', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    const [summary] = await getProjectSummaries([project.id], now, request.query.today);
    response.json(summary);
  });

  return router;
}
