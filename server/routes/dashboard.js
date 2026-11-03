import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Project } from '../models/index.js';
import { getDashboardData } from '../services/task-aggregates.js';
import { isAdmin } from '../services/access.js';

export function createDashboardRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  router.get('/dashboard', authenticate({ jwtSecret }), async (request, response) => {
    const filter = isAdmin(request.user) ? {} : { memberIds: request.user.id };
    const projects = await Project.find(filter).select('_id').lean();
    const projectIds = projects.map((project) => String(project._id));
    response.json(await getDashboardData(projectIds, request.user.id, now));
  });
  return router;
}
