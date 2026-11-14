import { Sprint, Task } from '../models/index.js';
import { RANK_STEP, leavesCompletedSprint, renumberRanks } from '../../src/lib/sprints.js';
import { toApi } from '../utils/to-api.js';

/** A sprint in API shape. */
export function sprintDto(sprint) {
  const dto = toApi(sprint);
  for (const key of ['startedAt', 'completedAt']) dto[key] = dto[key] ? new Date(dto[key]).toISOString() : null;
  return dto;
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

/**
 * Gives every task in the project a rank if any lacks one (tasks created before ranking existed),
 * keeping the order they show in now. Rank changes are not edits, so updatedAt stays put.
 */
export async function ensureRanks(projectId) {
  if (!(await Task.exists({ projectId, rank: null }))) return;
  await renumberProject(projectId);
}

export async function renumberProject(projectId) {
  const tasks = await Task.find({ projectId }).select('_id rank createdAt').lean();
  const ranks = renumberRanks(tasks.map((task) => ({ id: String(task._id), rank: task.rank, createdAt: iso(task.createdAt) })));
  if (!ranks.length) return;
  await Task.bulkWrite(ranks.map(({ id, rank }) => ({ updateOne: { filter: { _id: id }, update: { $set: { rank } } } })), { timestamps: false });
}

/** The rank for a new task: the bottom of the project's order. */
export async function rankForNewTask(projectId) {
  await ensureRanks(projectId);
  const last = await Task.findOne({ projectId }).sort({ rank: -1 }).select('rank').lean();
  return (last?.rank ?? 0) + RANK_STEP;
}

/**
 * Reopening a task that was finished in a completed sprint takes it out of that sprint's record
 * and back to the backlog. Call before saving a status change; returns the activity entry or null.
 */
export async function releaseFromCompletedSprint(task, fromStatus) {
  if (!task.sprintId) return null;
  const sprint = await Sprint.findById(task.sprintId).select('state').lean();
  if (!leavesCompletedSprint(sprint, fromStatus, task.status)) return null;
  const from = task.sprintId;
  task.sprintId = null;
  return { action: 'sprint', details: { from, to: null } };
}
