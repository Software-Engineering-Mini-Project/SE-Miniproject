import { Activity, User } from '../models/index.js';
import { taskChangeActivities, taskSnapshot } from '../../src/lib/activity.js';

export { taskSnapshot };
import { toApi } from '../utils/to-api.js';

/** Writes activity entries ({ action, details }) for one task, by one person, at one time. */
export async function recordActivity({ task, actorId, entries, at = new Date() }) {
  if (!entries.length) return;
  await Activity.insertMany(entries.map((entry) => ({
    taskId: String(task.id ?? task._id),
    projectId: String(task.projectId),
    actorId,
    action: entry.action,
    details: entry.details ?? {},
    createdAt: at,
    updatedAt: at,
  })));
}

/** Records one entry per field that changed between two snapshots. */
export function recordTaskChanges({ task, before, actorId, at }) {
  return recordActivity({ task, actorId, at, entries: taskChangeActivities(before, taskSnapshot(task)) });
}

/** Activity entries in API shape, each with its actor as { id, name } (null if the account is gone). */
export async function activityDtos(entries) {
  const actorIds = [...new Set(entries.map((entry) => entry.actorId).filter(Boolean))];
  const actors = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select('_id name').lean() : [];
  const byId = new Map(actors.map((actor) => [String(actor._id), { id: String(actor._id), name: actor.name }]));
  return entries.map((entry) => {
    const dto = toApi(entry);
    delete dto.updatedAt;
    return { ...dto, actor: byId.get(String(entry.actorId)) ?? null };
  });
}
