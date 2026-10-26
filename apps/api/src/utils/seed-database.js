import bcrypt from 'bcryptjs';
import comments from '../../../web/fixtures/comments.json' with { type: 'json' };
import notifications from '../../../web/fixtures/notifications.json' with { type: 'json' };
import projects from '../../../web/fixtures/projects.json' with { type: 'json' };
import tasks from '../../../web/fixtures/tasks.json' with { type: 'json' };
import users from '../../../web/fixtures/users.json' with { type: 'json' };
import { Comment, models, Notification, Project, Task, User } from '../models/index.js';

export const FIXTURE_PASSWORD = 'Password123!';

export async function seedDatabase() {
  await Promise.all(models.map((model) => model.deleteMany({})));

  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);
  await User.insertMany(users.map(({ id, ...user }) => ({
    ...user,
    _id: id,
    emailNormalized: user.email.trim().toLowerCase(),
    passwordHash,
  })));
  await Project.insertMany(projects.map(({ id, ...project }) => ({ ...project, _id: id })));
  await Task.insertMany(tasks.map(({ id, ...task }) => ({ ...task, _id: id })));
  await Comment.insertMany(comments.map(({ id, ...comment }) => ({ ...comment, _id: id })));

  const taskProjects = new Map(tasks.map((task) => [task.id, task.projectId]));
  await Notification.insertMany(notifications.map(({ id, ...notification }) => {
    const task = tasks.find((item) => item.id === notification.taskId);
    return {
      ...notification,
      _id: id,
      projectId: notification.projectId ?? taskProjects.get(notification.taskId) ?? null,
      dedupeKey: notification.type === 'due-date' && task?.dueDate
        ? `${notification.taskId}:${task.dueDate}`
        : null,
    };
  }));

  return { users: users.length, projects: projects.length, tasks: tasks.length, comments: comments.length, notifications: notifications.length };
}
