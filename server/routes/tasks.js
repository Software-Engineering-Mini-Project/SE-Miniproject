import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Comment, Notification, Project, Task, User } from '../models/index.js';
import { CHECKLIST_LIMIT, CHECKLIST_TEXT_MAX } from '../models/task.js';
import { projectRoleOf, roleAllows } from '../../src/lib/permissions.js';
import { getProjectForUser, getTaskForUser, isAdmin } from '../services/access.js';
import { tasksToCsv } from '../utils/csv.js';
import { HttpError } from '../utils/http-error.js';
import { readListOptions } from '../utils/pagination.js';
import { toApi } from '../utils/to-api.js';
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
const TASK_FIELDS = '_id title description status priority dueDate completedAt checklist projectId assigneeIds createdAt updatedAt';
// The export leaves out descriptions and checklists (an inclusion projection can't also exclude a field).
const EXPORT_FIELDS = TASK_FIELDS.replace(' description', '').replace(' checklist', '');

/** Sets the status and keeps completedAt in step: stamped on entering Done, cleared on leaving. */
function applyStatus(task, status, now) {
  if (status === task.status && (status !== 'Done' || task.completedAt)) return;
  task.status = status;
  task.completedAt = status === 'Done' ? now() : null;
}
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
  const users = await User.find({ _id: { $in: assigneeIds } }).select('_id');
  const registered = new Set(users.map((user) => user.id));
  if (assigneeIds.some((id) => !registered.has(id) || !projectRoleOf(project, id))) {
    invalid('Every assignee must be a registered member of this project.', {
      assigneeIds: 'Choose members of this project.',
    });
  }
  // Viewers are read-only, so they can't be given work.
  if (assigneeIds.some((id) => !roleAllows(projectRoleOf(project, id), 'task.assignable'))) {
    invalid('Viewers cannot be assigned tasks.', { assigneeIds: 'Viewers cannot be assigned tasks.' });
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
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    const filters = readTaskFilters(request.query);
    const tasks = (await Task.find(combineFilters({ projectId: project.id }, filters))
      .select(EXPORT_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .lean()).map(toApi);
    const userIds = [...new Set(tasks.flatMap((task) => task.assigneeIds))];
    const users = await User.find({ _id: { $in: userIds } }).select('_id name').lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    response.type('text/csv; charset=utf-8').send(tasksToCsv(tasks, usersById));
  });

  router.get('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    const filters = readTaskFilters(request.query);
    const options = readListOptions(request.query);
    const tasks = await Task.find(combineFilters({ projectId: project.id }, filters))
      .select(TASK_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();
    response.json(tasks.map(toApi));
  });

  router.post('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'task.create' });
    const body = requireObject(request.body);
    const input = readTaskInput(body, { create: true });
    await validateAssignees(input.assigneeIds, project);
    const task = await Task.create({ ...input, projectId: project.id, completedAt: input.status === 'Done' ? now() : null });
    await notifyNewAssignees({ task, actorId: request.user.id, now });
    response.status(201).json(task);
  });

  router.get('/tasks', requireAuth, async (request, response) => {
    const filters = readTaskFilters(request.query, { includeProjectId: true });
    const options = readListOptions(request.query);
    let projectIds;
    if (filters.projectId) {
      const project = await getProjectForUser(request.user, filters.projectId);
      projectIds = [project.id];
      delete filters.projectId;
    } else {
      // Admins see every project in their organisation, everyone else the ones they are in.
      const filter = isAdmin(request.user)
        ? { organisationId: request.user.organisationId }
        : { organisationId: request.user.organisationId, memberIds: request.user.id };
      const projects = await Project.find(filter).select('_id').lean();
      projectIds = projects.map((project) => String(project._id));
    }
    if (projectIds.length === 0) return response.json([]);
    const tasks = await Task.find(combineFilters({ projectId: { $in: projectIds } }, filters))
      .select(TASK_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();
    response.json(tasks.map(toApi));
  });

  router.get('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { lean: true });
    response.json(toApi(task));
  });

  router.patch('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.edit' });
    const body = requireObject(request.body);
    const input = readTaskInput(body);
    if (Object.keys(input).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a task field to update.');
    if (input.assigneeIds) await validateAssignees(input.assigneeIds, project);
    const previousIds = task.assigneeIds.map(String);
    const { status, ...rest } = input;
    Object.assign(task, rest);
    if (status) applyStatus(task, status, now);
    await task.save();
    await notifyNewAssignees({ task, previousIds, actorId: request.user.id, now });
    response.json(task);
  });

  router.delete('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.delete' });
    await Promise.all([
      Comment.deleteMany({ taskId: task.id }),
      Notification.deleteMany({ taskId: task.id }),
    ]);
    await task.deleteOne();
    response.status(204).end();
  });

  // Checklist items change one at a time with atomic updates, so two people working through
  // the same checklist never overwrite each other. Ticking an item is progress, like moving the
  // task (task.status); adding, renaming and removing items is editing the task (task.edit).
  const checklistResponse = (task) => ({ taskId: task.id, checklist: task.checklist, updatedAt: task.updatedAt });
  const readItemText = (body) => readString(body, 'text', { max: CHECKLIST_TEXT_MAX, label: 'Checklist item' });
  const itemNotFound = () => new HttpError(404, 'NOT_FOUND', 'Checklist item not found.');

  router.post('/tasks/:taskId/checklist', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.edit', lean: true });
    const text = readItemText(requireObject(request.body));
    const updated = await Task.findOneAndUpdate(
      { _id: task._id, [`checklist.${CHECKLIST_LIMIT - 1}`]: { $exists: false } },
      { $push: { checklist: { id: randomUUID(), text, done: false } } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) invalid(`A task can have at most ${CHECKLIST_LIMIT} checklist items.`, { text: `A task can have at most ${CHECKLIST_LIMIT} checklist items.` });
    response.status(201).json(checklistResponse(updated));
  });

  router.patch('/tasks/:taskId/checklist/:itemId', requireAuth, async (request, response) => {
    const body = requireObject(request.body);
    const changes = {};
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') invalid('Done must be true or false.', { done: 'Done must be true or false.' });
      changes['checklist.$.done'] = body.done;
    }
    if (body.text !== undefined) changes['checklist.$.text'] = readItemText(body);
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide done or text to update.');
    // Renaming needs edit rights; ticking needs status rights (which editors also have).
    const action = body.text !== undefined ? 'task.edit' : 'task.status';
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action, lean: true });
    const updated = await Task.findOneAndUpdate(
      { _id: task._id, 'checklist.id': request.params.itemId },
      { $set: changes },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) throw itemNotFound();
    response.json(checklistResponse(updated));
  });

  router.delete('/tasks/:taskId/checklist/:itemId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.edit', lean: true });
    const updated = await Task.findOneAndUpdate(
      { _id: task._id, 'checklist.id': request.params.itemId },
      { $pull: { checklist: { id: request.params.itemId } } },
      { returnDocument: 'after' },
    );
    if (!updated) throw itemNotFound();
    response.json(checklistResponse(updated));
  });

  router.patch('/tasks/:taskId/status', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.status' });
    const body = requireObject(request.body);
    applyStatus(task, readEnum(body, 'status', STATUSES, { label: 'Status' }), now);
    await task.save();
    response.json({ taskId: task.id, status: task.status, completedAt: task.completedAt, updatedAt: task.updatedAt });
  });

  return router;
}
