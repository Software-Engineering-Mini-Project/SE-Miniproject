import mongoose from 'mongoose';
import { createSchema } from './schema.js';
import { DEFAULT_TASK_TYPE, LABEL_MAX, LABELS_PER_TASK, STORY_POINTS, TASK_TYPES } from '../../src/lib/work-items.js';

export const CHECKLIST_LIMIT = 50;
export const CHECKLIST_TEXT_MAX = 200;

/** A checklist item (sub-step) of a task. Items keep their own id so edits target one item. */
const checklistItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true, trim: true, minlength: 1, maxlength: CHECKLIST_TEXT_MAX },
  done: { type: Boolean, default: false },
}, { _id: false });

const taskSchema = createSchema({
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
  description: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: ['To Do', 'In Progress', 'Done'], default: 'To Do', required: true },
  priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium', required: true },
  dueDate: { type: String, default: null },
  projectId: { type: String, ref: 'Project', required: true },
  // Number within the project (ALPHA-12 is number 12); taken from Project.taskCounter.
  number: { type: Number, min: 1 },
  assigneeIds: [{ type: String, ref: 'User' }],
  // Work-item fields (src/lib/work-items.js): what kind of work it is, its size, free-text labels
  // scoped to the project, and the epic it belongs to (an epic never belongs to another epic).
  type: { type: String, enum: TASK_TYPES, default: DEFAULT_TASK_TYPE },
  storyPoints: { type: Number, enum: [...STORY_POINTS, null], default: null },
  labels: {
    type: [{ type: String, maxlength: LABEL_MAX }],
    default: [],
    validate: { validator: (labels) => labels.length <= LABELS_PER_TASK, message: `A task can have at most ${LABELS_PER_TASK} labels.` },
  },
  epicId: { type: String, ref: 'Task', default: null },
  // Set by the server when the task enters Done and cleared when it leaves; the delivery
  // forecast (src/lib/forecast.js) samples throughput from it.
  completedAt: { type: Date, default: null },
  checklist: {
    type: [checklistItemSchema],
    default: [],
    validate: { validator: (items) => items.length <= CHECKLIST_LIMIT, message: `A task can have at most ${CHECKLIST_LIMIT} checklist items.` },
  },
});

taskSchema.index({ projectId: 1, status: 1, dueDate: 1 });
taskSchema.index({ projectId: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'number' } } });
taskSchema.index({ assigneeIds: 1 });
taskSchema.index({ projectId: 1, epicId: 1 });
taskSchema.index({ projectId: 1, labels: 1 });
taskSchema.index({ dueDate: 1, status: 1 });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
