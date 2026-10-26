import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const commentSchema = createSchema({
  taskId: { type: String, ref: 'Task', required: true },
  authorId: { type: String, ref: 'User', required: true },
  text: { type: String, required: true, minlength: 1, maxlength: 1000 },
});

commentSchema.index({ taskId: 1, createdAt: 1 });

export const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
