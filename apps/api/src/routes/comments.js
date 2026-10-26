import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Comment } from '../models/index.js';
import { getTaskForUser } from '../services/access.js';
import { commentDto, commentDtos } from '../utils/dto.js';
import { readString, requireObject, invalid } from '../utils/validation.js';

export function createCommentsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/tasks/:taskId/comments', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId);
    const comments = await Comment.find({ taskId: task.id }).sort({ createdAt: 1 });
    response.json(await commentDtos(comments));
  });

  router.post('/tasks/:taskId/comments', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId);
    const body = requireObject(request.body);
    const text = readString(body, 'text', { max: 1000, trim: false, label: 'Comment' });
    if (!text.trim()) invalid('Comment is required.', { text: 'Enter a comment.' });
    const comment = await Comment.create({ taskId: task.id, authorId: request.user.id, text, createdAt: now() });
    response.status(201).json(await commentDto(comment));
  });

  return router;
}
