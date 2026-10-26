import { Router } from 'express';
import { createAuthRouter } from './auth.js';
import { createCommentsRouter } from './comments.js';
import { createNotificationsRouter } from './notifications.js';
import { createProjectsRouter } from './projects.js';
import { createTasksRouter } from './tasks.js';
import { createUsersRouter } from './users.js';

export function createApiRouter({ jwtSecret, jwtExpiresIn, now } = {}) {
  const router = Router();
  router.use('/auth', createAuthRouter({ jwtSecret, jwtExpiresIn, now }));
  router.use('/users', createUsersRouter({ jwtSecret }));
  router.use(createProjectsRouter({ jwtSecret, now }));
  router.use(createTasksRouter({ jwtSecret, now }));
  router.use(createCommentsRouter({ jwtSecret, now }));
  router.use(createNotificationsRouter({ jwtSecret, now }));
  return router;
}
