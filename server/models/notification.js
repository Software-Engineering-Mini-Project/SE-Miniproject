import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const notificationSchema = createSchema({
  userId: { type: String, ref: 'User', required: true },
  taskId: { type: String, ref: 'Task', required: true },
  projectId: { type: String, ref: 'Project', default: null },
  type: { type: String, enum: ['assignment', 'due-date'], required: true },
  message: { type: String, required: true, maxlength: 1000 },
  read: { type: Boolean, default: false },
  dedupeKey: { type: String, default: null },
});

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, taskId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { type: 'due-date', dedupeKey: { $type: 'string' } } },
);

export const Notification = mongoose.models.Notification
  || mongoose.model('Notification', notificationSchema);
