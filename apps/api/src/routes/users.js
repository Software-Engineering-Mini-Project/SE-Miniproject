import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { updateCurrentUser } from './auth.js';

export function createUsersRouter({ jwtSecret } = {}) {
  const router = Router();
  router.patch('/me', authenticate({ jwtSecret }), async (request, response) => {
    response.json(await updateCurrentUser(request.authUser, request.body));
  });
  return router;
}
