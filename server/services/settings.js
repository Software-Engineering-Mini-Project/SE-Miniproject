import { DEFAULT_WORKSPACE_SETTINGS } from '../../src/lib/permissions.js';
import { Setting, WORKSPACE_SETTINGS_ID } from '../models/setting.js';

/** The workspace settings, with defaults for anything not stored yet. */
export async function getWorkspaceSettings() {
  const stored = await Setting.findById(WORKSPACE_SETTINGS_ID).select('projectCreation').lean();
  return { projectCreation: stored?.projectCreation ?? DEFAULT_WORKSPACE_SETTINGS.projectCreation };
}
