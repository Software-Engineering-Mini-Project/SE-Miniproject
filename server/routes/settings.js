import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Organisation } from '../models/index.js';
import { PROJECT_CREATION } from '../../src/lib/permissions.js';
import { isAdmin } from '../services/access.js';
import { getWorkspaceSettings } from '../services/settings.js';
import { HttpError } from '../utils/http-error.js';
import { readEnum, requireObject } from '../utils/validation.js';

/** The caller's organisation settings: everyone signed in can read them (the UI needs them); only Admins change them. */
export function createSettingsRouter({ jwtSecret } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/', requireAuth, async (request, response) => {
    response.json(await getWorkspaceSettings(request.user.organisationId));
  });

  router.patch('/', requireAuth, async (request, response) => {
    if (!isAdmin(request.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can change organisation settings.');
    const body = requireObject(request.body);
    const projectCreation = readEnum(body, 'projectCreation', PROJECT_CREATION, { label: 'Project creation' });
    const { organisationId } = request.user;
    const previous = await getWorkspaceSettings(organisationId);
    await Organisation.updateOne({ _id: organisationId }, { $set: { projectCreation } }, { runValidators: true });
    if (previous.projectCreation !== projectCreation) {
      response.locals.auditChange = { field: 'projectCreation', from: previous.projectCreation, to: projectCreation };
    }
    response.json(await getWorkspaceSettings(organisationId));
  });

  return router;
}
