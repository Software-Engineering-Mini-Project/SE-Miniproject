import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const projectSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, default: '', maxlength: 2000 },
  ownerId: { type: String, ref: 'User', required: true },
  memberIds: [{ type: String, ref: 'User' }],
});

projectSchema.index({ memberIds: 1 });

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
