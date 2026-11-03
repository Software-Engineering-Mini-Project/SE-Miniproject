import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Comment, Notification, Project, Task, User } from '../models/index.js';
import { getProjectForUser, getTaskForUser, isAdmin } from '../services/access.js';
import { tasksToCsv } from '../utils/csv.js';
import { HttpError } from '../utils/http-error.js';
import {
  escapeRegex,
  invalid,
  readDateOnly,
  readEnum,
  readFilterString,
  readId,
  readString,
  readStringArray,
  requireObject,
} from '../utils/validation.js';

const STATUSES = ['To Do', 'In Progress', 'Done'];
const PRIORITIES = ['High', 'Medium', 'Low'];

function readTaskFilters(query, { includeProjectId = false } = {}) {
  const filters = {};
  const q = readFilterString(query, 'q');
  const status = readFilterString(query, 'status', 32);
  const priority = readFilterString(query, 'priority', 16);
  const assigneeId = readFilterString(query, 'assigneeId', 64);
  const projectId = includeProjectId ? readFilterString(query, 'projectId', 64) : undefined;

  if (q) filters.$or = [
    { title: { $regex: escapeRegex(q), $options: 'i' } },
    { description: { $regex: escapeRegex(q), $options: 'i' } },
  ];
  if (status) filters.status = readEnum({ status }, 'status', STATUSES, { label: 'Status' });
  if (priority) filters.priority = readEnum({ priority }, 'priority', PRIORITIES, { label: 'Priority' });
  if (assigneeId) filters.assigneeIds = readId(assigneeId, 'Assignee');
  if (projectId) filters.projectId = readId(projectId, 'Project');
  return filters;
}

function readTaskInput(body, { create = false } = {}) {
  const input = {};
  if (create || body.title !== undefined) input.title = readString(body, 'title', { required: create, max: 200, label: 'Title' });
  if (body.description !== undefined) {
    input.description = readString(body, 'description', { required: false, max: 2000, allowEmpty: true, label: 'Description' });
  } else if (create) input.description = '';
  if (create || body.status !== undefined) {
    input.status = body.status === undefined && create
      ? 'To Do'
      : readEnum(body, 'status', STATUSES, { required: create, label: 'Status' });
  }
  if (create || body.priority !== undefined) {
    input.priority = body.priority === undefined && create
      ? 'Medium'
      : readEnum(body, 'priority', PRIORITIES, { required: create, label: 'Priority' });
  }
  if (body.dueDate !== undefined || create) input.dueDate = readDateOnly(body);
  if (body.assigneeIds !== undefined || create) input.assigneeIds = readStringArray(body, 'assigneeIds') ?? [];
  return input;
}

async function validateAssignees(assigneeIds, project) {
  const projectMembers = new Set(project.memberIds.map(String));
  const users = await User.find({ _id: { $in: assigneeIds } }).select('_id');
  const registered = new Set(users.map((user) => user.id));
  if (assigneeIds.some((id) => !registered.has(id) || !projectMembers.has(id))) {
    invalid('Every assignee must be a registered member of this project.', {
      assigneeIds: 'Choose members of this project.',
    });
  }
}

async function notifyNewAssignees({ task, previousIds = [], actorId, now }) {
  const existing = new Set(previousIds);
  const newIds = task.assigneeIds.filter((id) => !existing.has(id) && id !== actorId);
  if (newIds.length === 0) return;
  await Notification.insertMany(newIds.map((userId) => ({
    userId,
    taskId: task.id,
    projectId: task.projectId,
    type: 'assignment',
    message: `You were assigned to "${task.title}".`,
    read: false,
    createdAt: now(),
  })));
}

function combineFilters(base, filters) {
  const result = { ...base };
  const or = filters.$or;
  delete filters.$or;
  Object.assign(result, filters);
  if (or) result.$and = [...(result.$and || []), { $or: or }];
  return result;
}

export function createTasksRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/projects/:projectId/tasks/export.csv', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId);
    const filters = readTaskFilters(request.query);
    const tasks = await Task.find(combineFilters({ projectId: project.id }, filters)).sort({ createdAt: 1 });
    const userIds = [...new Set(tasks.flatMap((task) => task.assigneeIds))];
    const users = await User.find({ _id: { $in: userIds } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    response.type('text/csv; charset=utf-8').send(tasksToCsv(tasks, usersById));
  });

  router.get('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId);
    const filters = readTaskFilters(request.query);
    const tasks = await Task.find(combineFilters({ projectId: project.id }, filters)).sort({ createdAt: 1 });
    response.json(tasks);
  });

  router.post('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { manage: true });
    const body = requireObject(request.body);
    const input = readTaskInput(body, { create: true });
    await validateAssignees(input.assigneeIds, project);
    const task = await Task.create({ ...input, projectId: project.id });
    await notifyNewAssignees({ task, actorId: request.user.id, now });
    response.status(201).json(task);
  });

  router.get('/tasks', requireAuth, async (request, response) => {
    const filters = readTaskFilters(request.query, { includeProjectId: true });
    let projectIds;
    if (filters.projectId) {
      const project = await getProjectForUser(request.user, filters.projectId);
      projectIds = [project.id];
      delete filters.projectId;
    } else if (isAdmin(request.user)) {
      projectIds = null;
    } else {
      const projects = await Project.find({ memberIds: request.user.id }).select('_id');
      projectIds = projects.map((project) => project.id);
    }
    if (projectIds && projectIds.length === 0) return response.json([]);
    const query = projectIds ? combineFilters({ projectId: { $in: projectIds } }, filters) : combineFilters({}, filters);
    response.json(await Task.find(query).sort({ createdAt: 1 }));
  });

  router.get('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId);
    response.json(task);
  });

  router.patch('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId, { manage: true });
    const body = requireObject(request.body);
    const input = readTaskInput(body);
    if (Object.keys(input).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a task field to update.');
    if (input.assigneeIds) await validateAssignees(input.assigneeIds, project);
    const previousIds = task.assigneeIds.map(String);
    Object.assign(task, input);
    await task.save();
    await notifyNewAssignees({ task, previousIds, actorId: request.user.id, now });
    response.json(task);
  });

  router.delete('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { manage: true });
    await Promise.all([
      Comment.deleteMany({ taskId: task.id }),
      Notification.deleteMany({ taskId: task.id }),
    ]);
    await task.deleteOne();
    response.status(204).end();
  });

  router.patch('/tasks/:taskId/status', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId);
    const body = requireObject(request.body);
    task.status = readEnum(body, 'status', STATUSES, { label: 'Status' });
    await task.save();
    response.json({ taskId: task.id, status: task.status, updatedAt: task.updatedAt });
  });

  return router;
}
