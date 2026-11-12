import { Project, Task } from '../models/index.js';
import { can, canCreateProject, isAdmin } from '../../src/lib/permissions.js';
import { getWorkspaceSettings } from './settings.js';
import { HttpError } from '../utils/http-error.js';
import { readId } from '../utils/validation.js';

export { isAdmin };

/** Fields every authorization check needs; kept in one place so lean queries never miss one. */
export const PROJECT_ACCESS_FIELDS = '_id organisationId name description key previousKeys ownerId memberIds managerIds viewerIds visibility createdAt updatedAt';

const FORBIDDEN = {
  'project.edit': 'Only the project owner, a manager or an admin can edit this project.',
  'project.delete': 'Only the project owner or an admin can delete this project.',
  'project.key': 'Only the project owner or an admin can change the project key.',
  'members.manage': 'Only the project owner, a manager or an admin can manage members.',
  'task.create': 'Viewers cannot create tasks.',
  'task.edit': 'Viewers cannot edit tasks.',
  'task.delete': 'Only the project owner, a manager or an admin can delete tasks.',
  'task.status': 'Viewers cannot change task status.',
  'comment.create': 'You cannot comment in this project.',
};

/** True when `record` belongs to the same organisation as `user`. Nothing crosses organisations. */
export function inOrganisation(user, record) {
  return Boolean(user.organisationId) && String(record.organisationId) === String(user.organisationId);
}

export function forbidden(message) {
  return new HttpError(403, 'FORBIDDEN', message);
}

/**
 * Loads a project the user can see and checks `action` (see src/lib/permissions.js).
 * Non-members get 403 for every action, so the response doesn't reveal what they could do.
 */
export async function getProjectForUser(user, rawProjectId, { action = 'project.view', lean = false } = {}) {
  const projectId = readId(rawProjectId, 'Project');
  const query = Project.findById(projectId);
  const project = lean ? await query.select(PROJECT_ACCESS_FIELDS).lean() : await query;
  // Another organisation's project looks exactly like one that doesn't exist, admins included.
  if (!project || !inOrganisation(user, project)) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
  if (lean) project.id = String(project._id);
  if (!can(user, 'project.view', project)) {
    // An open project can be joined, so say so (the UI offers a Join button); a private one stays opaque.
    if (project.visibility === 'open') throw new HttpError(403, 'JOIN_REQUIRED', 'This project is open to everyone in the workspace. Join it to see its work.');
    throw forbidden('You are not a member of this project.');
  }
  if (action !== 'project.view' && !can(user, action, project)) {
    throw forbidden(FORBIDDEN[action] ?? 'You do not have permission to do this.');
  }
  return project;
}

export async function getTaskForUser(user, rawTaskId, { action = 'project.view', lean = false } = {}) {
  const taskId = readId(rawTaskId, 'Task');
  const query = Task.findById(taskId);
  const task = lean
    ? await query.select('_id title description status priority dueDate completedAt checklist projectId number assigneeIds createdAt updatedAt').lean()
    : await query;
  if (!task) throw new HttpError(404, 'NOT_FOUND', 'Task not found.');
  if (lean) task.id = String(task._id);
  const project = await getProjectForUser(user, task.projectId, { action, lean });
  return { task, project };
}

export async function requireProjectCreator(user) {
  if (!canCreateProject(user, await getWorkspaceSettings(user.organisationId))) {
    throw forbidden('In this workspace only leads and admins can create projects. Ask an admin, or join an open project.');
  }
}
