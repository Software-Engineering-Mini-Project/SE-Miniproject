import mongoose from 'mongoose';
import { PROJECT_CREATION } from '../../src/lib/permissions.js';
import { ORGANISATION_NAME_MAX } from '../../src/lib/organisation.js';
import { createSchema } from './schema.js';

/**
 * An organisation owns accounts and projects; nothing crosses between organisations. Its settings
 * live here (the old global "workspace" settings document is no longer read).
 */
const organisationSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: ORGANISATION_NAME_MAX },
  // The invite code people use to join as Members. Normalized (see normalizeJoinCode); an Admin can rotate it.
  joinCode: { type: String, required: true, uppercase: true, trim: true },
  createdById: { type: String, ref: 'User', default: null },
  projectCreation: { type: String, enum: PROJECT_CREATION, default: 'everyone', required: true },
});

organisationSchema.index({ joinCode: 1 }, { unique: true });

export const Organisation = mongoose.models.Organisation || mongoose.model('Organisation', organisationSchema);
