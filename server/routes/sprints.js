import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Activity, Project, Sprint, Task } from '../models/index.js';
import { getProjectForUser, getTaskForUser } from '../services/access.js';
import { recordActivity } from '../services/activity.js';
import { ensureRanks, renumberProject, sprintDto } from '../services/sprints.js';
import { taskDto } from '../services/work-items.js';
import { commitmentOf, completionPlan, rankBetween, readSprintFields, sprintName, sprintTargetError } from '../../src/lib/sprints.js';
import { buildSprintReport } from '../../src/lib/sprint-report.js';
import { HttpError } from '../utils/http-error.js';
import { invalid, readId, requireObject } from '../utils/validation.js';

const conflict = (errorCode, message) => new HttpError(409, errorCode, message);
const activeExists = (name) => conflict('ACTIVE_SPRINT_EXISTS', `Complete "${name}" before starting another sprint. A project runs one sprint at a time.`);
const isDuplicate = (error) => error?.code === 11000;

function readFields(body, options) {
  const { values, errors } = readSprintFields(body, options);
  const [field] = Object.keys(errors);
  if (field) invalid(errors[field], errors);
  return values;
}

/** Backlog and sprints (issue #76). Owners and Managers run sprints; Members plan tasks into them. */
export function createSprintsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  async function getSprintForUser(user, rawSprintId, { action = 'project.view' } = {}) {
    const sprint = await Sprint.findById(readId(rawSprintId, 'Sprint'));
    if (!sprint) throw new HttpError(404, 'NOT_FOUND', 'Sprint not found.');
    // Another organisation's sprint looks like one that doesn't exist (the project check is a 404).
    const project = await getProjectForUser(user, sprint.projectId, { action, lean: true });
    return { sprint, project };
  }

  /** Moves tasks to `to` (a sprint id or null), recording a `sprint` entry on each. */
  async function moveTasks(tasks, to, actorId) {
    if (!tasks.length) return;
    await Task.updateMany({ _id: { $in: tasks.map((task) => task._id) } }, { $set: { sprintId: to } });
    const at = now();
    await Promise.all(tasks.map((task) => recordActivity({
      task, actorId, at, entries: [{ action: 'sprint', details: { from: task.sprintId ?? null, to } }],
    })));
  }

  router.get('/projects/:projectId/sprints', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { lean: true });
    const sprints = await Sprint.find({ projectId: project.id }).sort({ number: 1 }).lean();
    response.json(sprints.map(sprintDto));
  });

  // Burndown and report for one sprint (issue #77), worked out from the activity history.
  router.get('/sprints/:sprintId/report', requireAuth, async (request, response) => {
    const { sprint, project } = await getSprintForUser(request.user, request.params.sprintId);
    const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
    const [tasks, activities] = await Promise.all([
      Task.find({ projectId: project.id }).select('_id sprintId status storyPoints completedAt').lean(),
      Activity.find({ projectId: project.id, action: { $in: ['sprint', 'status'] } }).select('taskId action details createdAt').lean(),
    ]);
    response.json(buildSprintReport({
      sprint: sprintDto(sprint),
      tasks: tasks.map((task) => ({ ...task, id: String(task._id), completedAt: iso(task.completedAt) })),
      activities: activities.map((entry) => ({ ...entry, createdAt: iso(entry.createdAt) })),
      today: now().toISOString().slice(0, 10),
    }));
  });

  router.post('/projects/:projectId/sprints', requireAuth, async (request, response) => {
    const project = await getProjectForUser(request.user, request.params.projectId, { action: 'sprint.manage', lean: true });
    const values = readFields(requireObject(request.body), { create: true });
    const existing = await Sprint.find({ projectId: project.id }).select('number').lean();
    const counter = await Project.findOneAndUpdate({ _id: project.id }, { $inc: { sprintCounter: 1 } }, { returnDocument: 'after' }).select('sprintCounter').lean();
    const number = Math.max(counter.sprintCounter, ...existing.map((sprint) => sprint.number + 1));
    const name = values.name ?? sprintName({ projectKey: project.key, projectName: project.name, number });
    const sprint = await Sprint.create({ ...values, name, projectId: project.id, number, state: 'planned' });
    response.status(201).json(sprintDto(sprint));
  });

  router.patch('/sprints/:sprintId', requireAuth, async (request, response) => {
    const { sprint } = await getSprintForUser(request.user, request.params.sprintId, { action: 'sprint.manage' });
    if (sprint.state === 'completed') throw conflict('SPRINT_COMPLETED', 'A completed sprint is a record and cannot be changed.');
    const values = readFields(requireObject(request.body), { current: sprint });
    if (Object.keys(values).length === 0) invalid('Provide a name, goal, start date or end date to update.');
    Object.assign(sprint, values);
    await sprint.save();
    response.json(sprintDto(sprint));
  });

  // Only a planned sprint can be deleted; its tasks go back to the backlog.
  router.delete('/sprints/:sprintId', requireAuth, async (request, response) => {
    const { sprint } = await getSprintForUser(request.user, request.params.sprintId, { action: 'sprint.manage' });
    if (sprint.state !== 'planned') throw conflict('SPRINT_NOT_PLANNED', 'Only a planned sprint can be deleted. Complete an active sprint instead.');
    const tasks = await Task.find({ sprintId: sprint.id }).select('_id projectId sprintId').lean();
    await moveTasks(tasks, null, request.user.id);
    await sprint.deleteOne();
    response.status(204).end();
  });

  router.post('/sprints/:sprintId/start', requireAuth, async (request, response) => {
    const { sprint, project } = await getSprintForUser(request.user, request.params.sprintId, { action: 'sprint.manage' });
    if (sprint.state !== 'planned') throw conflict('SPRINT_NOT_PLANNED', sprint.state === 'active' ? 'This sprint has already started.' : 'This sprint is complete.');
    const active = await Sprint.findOne({ projectId: project.id, state: 'active' }).select('name').lean();
    if (active) throw activeExists(active.name);
    const tasks = await Task.find({ sprintId: sprint.id }).select('_id storyPoints').lean();
    sprint.state = 'active';
    sprint.startedAt = now();
    sprint.committed = commitmentOf(tasks.map((task) => ({ id: String(task._id), storyPoints: task.storyPoints })));
    try {
      await sprint.save();
    } catch (error) {
      // Two sprints started at the same moment: the unique index lets only one through.
      if (isDuplicate(error)) throw activeExists((await Sprint.findOne({ projectId: project.id, state: 'active' }).select('name').lean())?.name ?? 'the active sprint');
      throw error;
    }
    response.json(sprintDto(sprint));
  });

  // Finished tasks stay as the sprint's record; unfinished ones go to the backlog or a planned sprint.
  router.post('/sprints/:sprintId/complete', requireAuth, async (request, response) => {
    const { sprint, project } = await getSprintForUser(request.user, request.params.sprintId, { action: 'sprint.manage' });
    if (sprint.state !== 'active') throw conflict('SPRINT_NOT_ACTIVE', sprint.state === 'planned' ? 'Start this sprint before completing it.' : 'This sprint is already complete.');
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    let moveTo = null;
    if (body.moveTo != null && body.moveTo !== 'backlog') {
      const target = await Sprint.findById(readId(body.moveTo, 'Sprint')).select('projectId state').lean();
      const problem = target?.state === 'active' ? 'Choose a planned sprint or the backlog.' : sprintTargetError(target, project.id);
      if (problem) invalid(problem, { moveTo: problem });
      moveTo = String(target._id);
    }
    const tasks = await Task.find({ sprintId: sprint.id }).select('_id projectId sprintId status storyPoints').lean();
    const plan = completionPlan(tasks.map((task) => ({ ...task, id: String(task._id) })), moveTo);
    await moveTasks(tasks.filter((task) => plan.moveIds.includes(String(task._id))), moveTo, request.user.id);
    sprint.state = 'completed';
    sprint.completedAt = now();
    sprint.report = plan.report;
    await sprint.save();
    response.json(sprintDto(sprint));
  });

  /**
   * Plans a task: into a sprint or the backlog (`sprintId`, null for the backlog), and/or to a
   * place in the ranked order, between `previousId` and `nextId` (either may be null for an end).
   * Without neighbours the task keeps its rank. Members may do this; Viewers may not.
   */
  router.post('/tasks/:taskId/move', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId, { action: 'task.edit' });
    const body = requireObject(request.body);
    const from = task.sprintId ?? null;
    let to = from;
    if (body.sprintId !== undefined) {
      to = body.sprintId === null ? null : readId(body.sprintId, 'Sprint');
      if (to) {
        const problem = sprintTargetError(await Sprint.findById(to).select('projectId state').lean(), project.id);
        if (problem) invalid(problem, { sprintId: problem });
      }
    }
    if (from !== to && from && task.status === 'Done') {
      const current = await Sprint.findById(from).select('state').lean();
      if (current?.state === 'completed') invalid('Finished work stays with the completed sprint it was done in.', { sprintId: 'Finished in a completed sprint.' });
    }
    const neighbourIds = {};
    for (const key of ['previousId', 'nextId']) {
      if (body[key] == null) continue;
      neighbourIds[key] = readId(body[key], 'Task');
      if (neighbourIds[key] === task.id) invalid('Place the task next to another task.', { [key]: 'Choose another task.' });
    }
    const placing = Object.keys(neighbourIds).length > 0;
    if (placing) {
      await ensureRanks(project.id);
      const loadRanks = async () => {
        const found = await Task.find({ _id: { $in: Object.values(neighbourIds) }, projectId: project.id }).select('_id rank').lean();
        if (found.length !== Object.keys(neighbourIds).length) invalid('Place the task next to tasks from this project.');
        const rankOf = (id) => (id ? found.find((item) => String(item._id) === id).rank : null);
        return rankBetween(rankOf(neighbourIds.previousId), rankOf(neighbourIds.nextId));
      };
      let placed = await loadRanks();
      if (placed.crowded) {
        await renumberProject(project.id);
        placed = await loadRanks();
      }
      task.rank = placed.rank;
    }
    if (!placing && from === to) return response.json(taskDto(task, project.key));
    task.sprintId = to;
    // Reordering is not an edit of the task, so it keeps its updatedAt; changing sprint is.
    await task.save({ timestamps: from !== to });
    if (from !== to) await recordActivity({ task, actorId: request.user.id, at: now(), entries: [{ action: 'sprint', details: { from, to } }] });
    response.json(taskDto(task, project.key));
  });

  return router;
}
