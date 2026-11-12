import mongoose from 'mongoose';
import { PROJECT_VISIBILITIES } from '../../src/lib/permissions.js';
import { createSchema } from './schema.js';

const projectSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, default: '', maxlength: 2000 },
  organisationId: { type: String, ref: 'Organisation', required: true },
  ownerId: { type: String, ref: 'User', required: true },
  // Everyone in the project, owner included. managerIds and viewerIds are subsets of memberIds
  // that set the project role (see src/lib/permissions.js); anyone else is a Member.
  memberIds: [{ type: String, ref: 'User' }],
  managerIds: { type: [{ type: String, ref: 'User' }], default: [] },
  viewerIds: { type: [{ type: String, ref: 'User' }], default: [] },
  // 'private': invite-only. 'open': listed in the project directory; anyone can join as a Member.
  visibility: { type: String, enum: PROJECT_VISIBILITIES, default: 'private' },
});

projectSchema.index({ memberIds: 1 });
projectSchema.index({ organisationId: 1, visibility: 1, name: 1 });

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
