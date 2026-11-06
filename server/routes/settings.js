import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Setting, WORKSPACE_SETTINGS_ID } from '../models/setting.js';
import { PROJECT_CREATION } from '../../src/lib/permissions.js';
import { isAdmin } from '../services/access.js';
import { getWorkspaceSettings } from '../services/settings.js';
import { HttpError } from '../utils/http-error.js';
import { readEnum, requireObject } from '../utils/validation.js';

/** Workspace settings: everyone signed in can read them (the UI needs them); only Admins change them. */
export function createSettingsRouter({ jwtSecret } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/', requireAuth, async (_request, response) => {
    response.json(await getWorkspaceSettings());
  });

  router.patch('/', requireAuth, async (request, response) => {
    if (!isAdmin(request.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can change workspace settings.');
    const body = requireObject(request.body);
    const projectCreation = readEnum(body, 'projectCreation', PROJECT_CREATION, { label: 'Project creation' });
    const previous = await getWorkspaceSettings();
    await Setting.updateOne({ _id: WORKSPACE_SETTINGS_ID }, { $set: { projectCreation } }, { upsert: true, runValidators: true });
    if (previous.projectCreation !== projectCreation) {
      response.locals.auditChange = { field: 'projectCreation', from: previous.projectCreation, to: projectCreation };
    }
    response.json(await getWorkspaceSettings());
  });

  return router;
}
