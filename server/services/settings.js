import { DEFAULT_WORKSPACE_SETTINGS } from '../../src/lib/permissions.js';
import { Organisation } from '../models/index.js';

/** An organisation's settings, with defaults for anything not stored. */
export async function getWorkspaceSettings(organisationId) {
  const stored = await Organisation.findById(organisationId).select('projectCreation').lean();
  return { projectCreation: stored?.projectCreation ?? DEFAULT_WORKSPACE_SETTINGS.projectCreation };
}
