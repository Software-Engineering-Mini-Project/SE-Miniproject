import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const taskSchema = createSchema({
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: ['To Do', 'In Progress', 'Done'], default: 'To Do', required: true },
  priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium', required: true },
  dueDate: { type: String, default: null },
  projectId: { type: String, ref: 'Project', required: true },
  assigneeIds: [{ type: String, ref: 'User' }],
});

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assigneeIds: 1 });
taskSchema.index({ dueDate: 1, status: 1 });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
