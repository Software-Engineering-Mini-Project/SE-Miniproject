import { Project, Task } from '../models/index.js';
import { HttpError } from '../utils/http-error.js';
import { readId } from '../utils/validation.js';

export function isAdmin(user) {
  return user.role === 'Admin';
}

export function isProjectMember(user, project) {
  return isAdmin(user) || project.memberIds.includes(user.id);
}

export function canManageProject(user, project) {
  return isAdmin(user) || (user.role === 'Lead' && project.memberIds.includes(user.id));
}

export async function getProjectForUser(user, rawProjectId, { manage = false, lean = false } = {}) {
  const projectId = readId(rawProjectId, 'Project');
  const query = Project.findById(projectId);
  const project = lean
    ? await query.select('_id name description ownerId memberIds createdAt updatedAt').lean()
    : await query;
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  if (lean) project.id = String(project._id);
  if (!isProjectMember(user, project)) {
    throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this project.');
  }
  if (manage && !canManageProject(user, project)) {
    throw new HttpError(403, 'FORBIDDEN', 'Only the project lead or an admin can do this.');
  }
  return project;
}

export async function getTaskForUser(user, rawTaskId, { manage = false, lean = false } = {}) {
  const taskId = readId(rawTaskId, 'Task');
  const query = Task.findById(taskId);
  const task = lean
    ? await query.select('_id title description status priority dueDate projectId assigneeIds createdAt updatedAt').lean()
    : await query;
  if (!task) throw new HttpError(404, 'NOT_FOUND', 'Task not found.');
  if (lean) task.id = String(task._id);
  const project = await getProjectForUser(user, task.projectId, { manage, lean });
  return { task, project };
}

export function requireProjectLead(user) {
  if (!isAdmin(user) && user.role !== 'Lead') {
    throw new HttpError(403, 'FORBIDDEN', 'Only a project lead or an admin can do this.');
  }
}
