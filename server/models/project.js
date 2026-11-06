import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const projectSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, default: '', maxlength: 2000 },
  ownerId: { type: String, ref: 'User', required: true },
  // Everyone in the project, owner included. managerIds and viewerIds are subsets of memberIds
  // that set the project role (see src/lib/permissions.js); anyone else is a Member.
  memberIds: [{ type: String, ref: 'User' }],
  managerIds: { type: [{ type: String, ref: 'User' }], default: [] },
  viewerIds: { type: [{ type: String, ref: 'User' }], default: [] },
});

projectSchema.index({ memberIds: 1 });

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
