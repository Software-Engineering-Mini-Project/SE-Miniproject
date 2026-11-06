import mongoose from 'mongoose';
import { PROJECT_CREATION } from '../../src/lib/permissions.js';
import { createSchema } from './schema.js';

/**
 * Workspace settings: one document, `_id: 'workspace'`. A missing document means the defaults
 * (DEFAULT_WORKSPACE_SETTINGS in src/lib/permissions.js).
 */
const settingSchema = createSchema({
  projectCreation: { type: String, enum: PROJECT_CREATION, default: 'everyone', required: true },
});

export const WORKSPACE_SETTINGS_ID = 'workspace';
export const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
