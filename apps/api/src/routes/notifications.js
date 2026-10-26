import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Notification, Task } from '../models/index.js';
import { HttpError } from '../utils/http-error.js';
import { readFilterString, readId, invalid } from '../utils/validation.js';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

async function generateDueReminders(now) {
  const timestamp = now().getTime();
  const tasks = await Task.find({ status: { $ne: 'Done' }, dueDate: { $ne: null }, assigneeIds: { $ne: [] } });
  const writes = [];
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const dueEnd = Date.parse(`${task.dueDate}T23:59:59.999Z`);
    if (!Number.isFinite(dueEnd) || dueEnd <= timestamp || dueEnd > timestamp + REMINDER_WINDOW_MS) continue;
    const dedupeKey = `${task.id}:${task.dueDate}`;
    for (const userId of task.assigneeIds) {
      writes.push(Notification.updateOne(
        { userId, taskId: task.id, type: 'due-date', dedupeKey },
        {
          $setOnInsert: {
            userId,
            taskId: task.id,
            projectId: task.projectId,
            type: 'due-date',
            message: `"${task.title}" is due within 24 hours.`,
            read: false,
            dedupeKey,
          },
        },
        { upsert: true },
      ));
    }
  }
  await Promise.all(writes);
}

function readPositiveInteger(query, key, fallback, max) {
  const value = readFilterString(query, key, 12);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    invalid(`${key} must be a number from 1 to ${max}.`, { [key]: `Enter a number from 1 to ${max}.` });
  }
  return parsed;
}

export function createNotificationsRouter({ jwtSecret, now = () => new Date() } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.get('/notifications', requireAuth, async (request, response) => {
    await generateDueReminders(now);
    const page = readPositiveInteger(request.query, 'page', 1, Number.MAX_SAFE_INTEGER);
    const pageSize = readPositiveInteger(request.query, 'pageSize', 50, 100);
    const filter = { userId: request.user.id };
    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, read: false }),
    ]);
    response.json({ items, page, pageSize, total, unreadCount });
  });

  router.patch('/notifications/:notificationId/read', requireAuth, async (request, response) => {
    await generateDueReminders(now);
    const notificationId = readId(request.params.notificationId, 'Notification');
    const notification = await Notification.findOne({ _id: notificationId, userId: request.user.id });
    if (!notification) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
    notification.read = true;
    await notification.save();
    response.json(notification);
  });

  return router;
}
