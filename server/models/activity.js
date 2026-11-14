import mongoose from 'mongoose';
import { createSchema } from './schema.js';
import { ACTIVITY_ACTIONS } from '../../src/lib/activity.js';

/**
 * One change to a task, by one person (issue #75). `details` depends on the action; see
 * src/lib/activity.js. Deleted with the task or its project.
 */
const activitySchema = createSchema({
  taskId: { type: String, ref: 'Task', required: true },
  projectId: { type: String, ref: 'Project', required: true },
  actorId: { type: String, ref: 'User', default: null },
  action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { minimize: false });

activitySchema.index({ taskId: 1, createdAt: -1, _id: -1 });
activitySchema.index({ projectId: 1 });

export const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
