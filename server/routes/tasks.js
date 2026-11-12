import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Activity, Comment, Notification, Project, Task, User } from '../models/index.js';
import { CHECKLIST_LIMIT, CHECKLIST_TEXT_MAX } from '../models/task.js';
import { projectRoleOf, roleAllows } from '../../src/lib/permissions.js';
import { PROJECT_ACCESS_FIELDS, getProjectForUser, getTaskForUser, inOrganisation, isAdmin } from '../services/access.js';
import { nextTaskNumber, taskDto, taskDtos } from '../services/work-items.js';
import { activityDtos, recordActivity, recordTaskChanges, taskSnapshot } from '../services/activity.js';
import { TASK_TYPES, epicRuleErrors, labelError, normalizeLabel, parseTaskKey, projectAnswersToKey, readWorkItemFields } from '../../src/lib/work-items.js';
import { tasksToCsv } from '../utils/csv.js';
import { HttpError } from '../utils/http-error.js';
import { readListOptions } from '../utils/pagination.js';
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
const TASK_FIELDS = '_id title description status priority dueDate completedAt checklist projectId number type storyPoints labels epicId assigneeIds createdAt updatedAt';
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
  const type = readFilterString(query, 'type', 16);
  const label = readFilterString(query, 'label', 64);
  const epicId = readFilterString(query, 'epicId', 64);

  if (q) filters.$or = [
    { title: { $regex: escapeRegex(q), $options: 'i' } },
    { description: { $regex: escapeRegex(q), $options: 'i' } },
  ];
  if (status) filters.status = readEnum({ status }, 'status', STATUSES, { label: 'Status' });
  if (priority) filters.priority = readEnum({ priority }, 'priority', PRIORITIES, { label: 'Priority' });
  if (assigneeId) filters.assigneeIds = readId(assigneeId, 'Assignee');
  if (projectId) filters.projectId = readId(projectId, 'Project');
  if (type) filters.type = readEnum({ type }, 'type', TASK_TYPES, { label: 'Type' });
  if (label) {
    const normalized = normalizeLabel(label);
    const problem = labelError(normalized);
    if (problem) invalid(problem, { label: problem });
    filters.labels = normalized;
  }
  if (epicId) filters.epicId = readId(epicId, 'Epic');
  if (q) Object.defineProperty(filters, 'q', { value: q, enumerable: false });
  return filters;
}

/**
 * When the search text is a task key (ALPHA-12, any case), also match that task: by number in
 * the projects among `projects` that use or used the key. Old keys keep working after a rename.
 */
function addKeySearch(filters, projects) {
  const parsed = parseTaskKey(filters.q);
  if (!parsed || !filters.$or) return filters;
  const projectIds = projects.filter((project) => projectAnswersToKey(project, parsed.projectKey)).map((project) => String(project._id ?? project.id));
  if (projectIds.length) filters.$or.push({ projectId: { $in: projectIds }, number: parsed.number });
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
  const workItem = readWorkItemFields(body, { create });
  const [field] = Object.keys(workItem.errors);
  if (field) invalid(workItem.errors[field], workItem.errors);
  return { ...input, ...workItem.values };
}

/**
 * Applies the epic rules (src/lib/work-items.js) to a task as it will be after a create or
 * update: its epic must be an Epic in the same project, an epic is never inside another, and an
 * epic keeps its type while it still holds items.
 */
async function checkEpicRules({ current = null, next }) {
  const epic = next.epicId
    ? await Task.findOne({ _id: next.epicId, projectId: next.projectId }).select('_id type projectId').lean()
    : null;
  const childCount = current?.type === 'Epic' && next.type !== 'Epic'
    ? await Task.countDocuments({ projectId: next.projectId, epicId: current.id })
    : 0;
  const errors = epicRuleErrors({ current, next, epic, childCount });
  const [field] = Object.keys(errors);
  if (field) invalid(errors[field], errors);
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

async function notifyNewAssignees({ task, key, previousIds = [], actorId, now }) {
  const existing = new Set(previousIds);
  const newIds = task.assigneeIds.filter((id) => !existing.has(id) && id !== actorId);
  if (newIds.length === 0) return;
  await Notification.insertMany(newIds.map((userId) => ({
    userId,
    taskId: task.id,
    projectId: task.projectId,
    type: 'assignment',
    message: key ? `You were assigned to ${key} "${task.title}".` : `You were assigned to "${task.title}".`,
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
    const filters = addKeySearch(readTaskFilters(request.query), [project]);
    const tasks = (await Task.find(combineFilters({ projectId: project.id }, filters))
      .select(EXPORT_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .lean()).map((task) => taskDto(task, project.key));
    const userIds = [...new Set(tasks.flatMap((task) => task.assigneeIds))];
    const users = await User.find({ _id: { $in: userIds } }).select('_id name').lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const epics = await Task.find({ projectId: project.id, type: 'Epic' }).select('_id number').lean();
    const epicKeys = new Map(epics.map((epic) => [String(epic._id), taskDto(epic, project.key).key]));
    response.type('text/csv; charset=utf-8').send(tasksToCsv(tasks, usersById, epicKeys));
  });

  router.get('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    const filters = addKeySearch(readTaskFilters(request.query), [project]);
    const options = readListOptions(request.query);
    const tasks = await Task.find(combineFilters({ projectId: project.id }, filters))
      .select(TASK_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();
    response.json(tasks.map((task) => taskDto(task, project.key)));
  });

  router.post('/projects/:projectId/tasks', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'task.create' });
    const body = requireObject(request.body);
    const input = readTaskInput(body, { create: true });
    await validateAssignees(input.assigneeIds, project);
    await checkEpicRules({ next: { ...input, projectId: project.id } });
    // The number is reserved before the insert; a failed insert leaves a gap, never a duplicate.
    const number = await nextTaskNumber(project.id);
    const at = now();
    const task = await Task.create({ ...input, projectId: project.id, number, completedAt: input.status === 'Done' ? at : null });
    await recordActivity({ task, actorId: request.user.id, at, entries: [{ action: 'created', details: { title: task.title, type: task.type } }] });
    const dto = taskDto(task, project.key);
    await notifyNewAssignees({ task, key: dto.key, actorId: request.user.id, now });
    response.status(201).json(dto);
  });

  router.get('/tasks', requireAuth, async (request, response) => {
    const filters = readTaskFilters(request.query, { includeProjectId: true });
    const options = readListOptions(request.query);
    let projects;
    if (filters.projectId) {
      projects = [await getProjectForUser(request.user, filters.projectId, { lean: true })];
      delete filters.projectId;
    } else {
      // Admins see every project in their organisation, everyone else the ones they are in.
      const filter = isAdmin(request.user)
        ? { organisationId: request.user.organisationId }
        : { organisationId: request.user.organisationId, memberIds: request.user.id };
      projects = await Project.find(filter).select('_id key previousKeys').lean();
    }
    if (projects.length === 0) return response.json([]);
    const projectIds = projects.map((project) => String(project._id));
    addKeySearch(filters, projects);
    const tasks = await Task.find(combineFilters({ projectId: { $in: projectIds } }, filters))
      .select(TASK_FIELDS)
      .sort({ createdAt: 1, _id: 1 })
      .skip(options.skip)
      .limit(options.limit)
      .lean();
    const keys = new Map(projects.map((project) => [String(project._id), project.key ?? null]));
    response.json(await taskDtos(tasks, keys));
  });

  // Opens a task by its key (ALPHA-12). A key the project used before still resolves, so links
  // survive a key change. Another organisation's keys look like keys that don't exist.
  router.get('/tasks/by-key/:key', requireAuth, async (request, response) => {
    const parsed = parseTaskKey(request.params.key);
    const notFound = () => new HttpError(404, 'NOT_FOUND', 'No task has that key.');
    if (!parsed) throw notFound();
    const candidates = await Project.find({
      organisationId: request.user.organisationId,
      $or: [{ key: parsed.projectKey }, { previousKeys: parsed.projectKey }],
    }).select(PROJECT_ACCESS_FIELDS).lean();
    // The project that uses the key now wins over one that used it before.
    const match = candidates.find((project) => project.key === parsed.projectKey) ?? candidates[0];
    if (!match || !inOrganisation(request.user, match)) throw notFound();
    const task = await Task.findOne({ projectId: String(match._id), number: parsed.number }).select(TASK_FIELDS).lean();
    if (!task) throw notFound();
    const project = await getProjectForUser(request.user, String(match._id), { lean: true });
    response.json(taskDto(task, project.key));
  });

  // Who changed what on a task, newest first (issue #75). Anyone who can open the task can read it.
  router.get('/tasks/:taskId/activity', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { lean: true });
    const options = readListOptions({ page: '1', ...request.query });
    const filter = { taskId: String(task._id) };
    const [entries, total] = await Promise.all([
      Activity.find(filter).sort({ createdAt: -1, _id: -1 }).skip(options.skip).limit(options.pageSize).lean(),
      Activity.countDocuments(filter),
    ]);
    response.json({ items: await activityDtos(entries), page: options.page, pageSize: options.pageSize, total });
  });

  router.get('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId, { lean: true });
    response.json(taskDto(task, project.key));
  });

  router.patch('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.edit' });
    const body = requireObject(request.body);
    const input = readTaskInput(body);
    if (Object.keys(input).length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a task field to update.');
    if (input.assigneeIds) await validateAssignees(input.assigneeIds, project);
    if (input.type !== undefined || input.epicId !== undefined) {
      const current = { id: task.id, type: task.type ?? 'Task', epicId: task.epicId ?? null };
      await checkEpicRules({
        current,
        next: { id: task.id, projectId: project.id, type: input.type ?? current.type, epicId: input.epicId !== undefined ? input.epicId : current.epicId },
      });
    }
    const previousIds = task.assigneeIds.map(String);
    const before = taskSnapshot(task);
    const { status, ...rest } = input;
    Object.assign(task, rest);
    if (status) applyStatus(task, status, now);
    await task.save();
    await recordTaskChanges({ task, before, actorId: request.user.id, at: now() });
    const dto = taskDto(task, project.key);
    await notifyNewAssignees({ task, key: dto.key, previousIds, actorId: request.user.id, now });
    response.json(dto);
  });

  router.delete('/tasks/:taskId', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.delete' });
    await Promise.all([
      Comment.deleteMany({ taskId: task.id }),
      Notification.deleteMany({ taskId: task.id }),
      Activity.deleteMany({ taskId: task.id }),
      // Deleting an epic keeps its items; they just no longer belong to an epic.
      Task.updateMany({ projectId: task.projectId, epicId: task.id }, { $set: { epicId: null } }),
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
    await recordActivity({ task: updated, actorId: request.user.id, at: now(), entries: [{ action: 'checklist.add', details: { text } }] });
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
    const item = task.checklist?.find((entry) => entry.id === request.params.itemId);
    const entries = [];
    if (item && body.done !== undefined && body.done !== item.done) entries.push({ action: 'checklist.check', details: { text: changes['checklist.$.text'] ?? item.text, done: body.done } });
    if (item && body.text !== undefined && changes['checklist.$.text'] !== item.text) entries.push({ action: 'checklist.rename', details: { from: item.text, to: changes['checklist.$.text'] } });
    await recordActivity({ task: updated, actorId: request.user.id, at: now(), entries });
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
    const item = task.checklist?.find((entry) => entry.id === request.params.itemId);
    await recordActivity({ task: updated, actorId: request.user.id, at: now(), entries: [{ action: 'checklist.remove', details: { text: item?.text ?? '' } }] });
    response.json(checklistResponse(updated));
  });

  router.patch('/tasks/:taskId/status', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.status' });
    const body = requireObject(request.body);
    const from = task.status;
    applyStatus(task, readEnum(body, 'status', STATUSES, { label: 'Status' }), now);
    await task.save();
    if (task.status !== from) {
      await recordActivity({ task, actorId: request.user.id, at: now(), entries: [{ action: 'status', details: { from, to: task.status } }] });
    }
    response.json({ taskId: task.id, status: task.status, completedAt: task.completedAt, updatedAt: task.updatedAt });
  });

  return router;
}
