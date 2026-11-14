import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Activity, Comment } from '../models/index.js';
import { can } from '../../src/lib/permissions.js';
import { getTaskForUser } from '../services/access.js';
import { recordActivity } from '../services/activity.js';
import { commentExcerpt } from '../../src/lib/activity.js';
import { HttpError } from '../utils/http-error.js';
import { commentDto, commentDtos } from '../utils/dto.js';
import { readId, readString, requireObject, invalid } from '../utils/validation.js';

export function createCommentsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/tasks/:taskId/comments', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { lean: true });
    const comments = await Comment.find({ taskId: task.id })
      .select('_id taskId authorId text createdAt updatedAt')
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    response.json(await commentDtos(comments));
  });

  router.post('/tasks/:taskId/comments', requireAuth, async (request, response) => {
    const { task } = await getTaskForUser(request.user, request.params.taskId, { action: 'comment.create' });
    const body = requireObject(request.body);
    const text = readString(body, 'text', { max: 1000, trim: false, label: 'Comment' });
    if (!text.trim()) invalid('Comment is required.', { text: 'Enter a comment.' });
    const at = now();
    const comment = await Comment.create({ taskId: task.id, authorId: request.user.id, text, createdAt: at });
    await recordActivity({ task, actorId: request.user.id, at, entries: [{ action: 'comment.add', details: { commentId: comment.id, excerpt: commentExcerpt(text) } }] });
    response.status(201).json(await commentDto(comment));
  });

  router.delete('/tasks/:taskId/comments/:commentId', requireAuth, async (request, response) => {
    const { task, project } = await getTaskForUser(request.user, request.params.taskId);
    const commentId = readId(request.params.commentId, 'Comment');
    const comment = await Comment.findOne({ _id: commentId, taskId: task.id });
    if (!comment) throw new HttpError(404, 'NOT_FOUND', 'Comment not found.');
    const canDelete = comment.authorId === request.user.id || can(request.user, 'comment.moderate', project);
    if (!canDelete) throw new HttpError(403, 'FORBIDDEN', 'You cannot delete this comment.');
    await comment.deleteOne();
    // The history keeps that a comment was made, but not the text of one that was deleted.
    await Activity.updateMany({ taskId: task.id, action: 'comment.add', 'details.commentId': comment.id }, { $set: { 'details.excerpt': null } });
    await recordActivity({ task, actorId: request.user.id, at: now(), entries: [{ action: 'comment.delete', details: { commentId: comment.id } }] });
    response.status(204).end();
  });

  return router;
}
