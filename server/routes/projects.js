import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Comment, Notification, Project, Task, User } from '../models/index.js';
import { getProjectForUser, isAdmin, requireProjectLead } from '../services/access.js';
import { memberDto, projectDto, projectDtos } from '../utils/dto.js';
import { HttpError } from '../utils/http-error.js';
import { normalizeEmail, readEmail, readId, readString, requireObject } from '../utils/validation.js';

export function createProjectsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/projects', requireAuth, async (request, response) => {
    const filter = isAdmin(request.user) ? {} : { memberIds: request.user.id };
    const projects = await Project.find(filter).sort({ createdAt: 1 });
    response.json(await projectDtos(projects));
  });

  router.post('/projects', requireAuth, async (request, response) => {
    requireProjectLead(request.user);
    const body = requireObject(request.body);
    const name = readString(body, 'name', { max: 80, label: 'Project name' });
    const description = readString(body, 'description', { required: false, max: 2000, allowEmpty: true, label: 'Description' });
    const project = await Project.create({
      name,
      description: description ?? '',
      ownerId: request.user.id,
      memberIds: [request.user.id],
    });
    response.status(201).json(await projectDto(project));
  });

  router.get('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId);
    response.json(await projectDto(project));
  });

  router.patch('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { manage: true });
    const body = requireObject(request.body);
    const changes = {};
    if (body.name !== undefined) changes.name = readString(body, 'name', { max: 80, label: 'Project name' });
    if (body.description !== undefined) {
      changes.description = readString(body, 'description', { required: false, max: 2000, allowEmpty: true, label: 'Description' });
    }
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a project field to update.');
    Object.assign(project, changes);
    await project.save();
    response.json(await projectDto(project));
  });

  router.delete('/projects/:projectId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { manage: true });
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
    const project = await getProjectForUser(request.user, request.params.projectId);
    const users = await User.find({ _id: { $in: project.memberIds } });
    const usersById = new Map(users.map((user) => [user.id, memberDto(user)]));
    response.json(project.memberIds.map(String).map((id) => usersById.get(id)).filter(Boolean));
  });

  router.post('/projects/:projectId/members', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { manage: true });
    const body = requireObject(request.body);
    const email = readEmail(body);
    const user = await User.findOne({ emailNormalized: normalizeEmail(email) });
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'No registered user has that email.', { email: 'Email is not registered.' });
    if (!project.memberIds.includes(user.id)) {
      project.memberIds.push(user.id);
      await project.save();
    }
    const members = await User.find({ _id: { $in: project.memberIds } });
    const membersById = new Map(members.map((member) => [member.id, memberDto(member)]));
    response.json(project.memberIds.map(String).map((id) => membersById.get(id)).filter(Boolean));
  });

  router.delete('/projects/:projectId/members/:userId', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { manage: true });
    const userId = readId(request.params.userId, 'User');
    if (!project.memberIds.includes(userId)) throw new HttpError(404, 'NOT_FOUND', 'Project member not found.');
    if (project.ownerId === userId) throw new HttpError(400, 'VALIDATION_ERROR', 'The project owner cannot be removed.');
    project.memberIds = project.memberIds.filter((id) => id !== userId);
    await project.save();
    await Task.updateMany({ projectId: project.id }, { $pull: { assigneeIds: userId } });
    const members = await User.find({ _id: { $in: project.memberIds } });
    const membersById = new Map(members.map((member) => [member.id, memberDto(member)]));
    response.json(project.memberIds.map(String).map((id) => membersById.get(id)).filter(Boolean));
  });

  router.get('/projects/:projectId/summary', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId);
    const tasks = await Task.find({ projectId: project.id });
    const counts = { 'To Do': 0, 'In Progress': 0, Done: 0 };
    let overdue = 0;
    const timestamp = now().getTime();
    for (const task of tasks) {
      counts[task.status] += 1;
      if (task.status !== 'Done' && task.dueDate) {
        const dueEnd = Date.parse(`${task.dueDate}T23:59:59.999Z`);
        if (dueEnd < timestamp) overdue += 1;
      }
    }
    response.json({ projectId: project.id, total: tasks.length, counts, overdue });
  });

  return router;
}
