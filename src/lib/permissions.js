/**
 * Who may do what. This module is the single source of truth for authorization: the Express
 * API, the in-browser mock API and the UI all import it, so a button is only shown when the
 * server would accept the request.
 *
 * Two layers (the model Plane and OpenProject use):
 * - Organisation role on the account (`user.role`): Admin manages accounts and settings and sees
 *   every project. Who may create projects is an organisation setting (`projectCreation`):
 *   'everyone' (the default, like Jira team-managed projects) or 'leads' (Leads and Admins).
 *   Anyone may join an Open project; Private projects are invite-only.
 * - Project role per membership: Owner, Manager, Member or Viewer. It decides what someone
 *   can do inside one project and is independent of the organisation role.
 *
 * Pure functions only, no imports: it runs in Node and in the browser.
 */

export const WORKSPACE_ROLES = ['Admin', 'Lead', 'Member'];
export const PROJECT_ROLES = ['Owner', 'Manager', 'Member', 'Viewer'];
/** Roles that can be given through the members dialog; Owner moves only by transfer. */
export const GRANTABLE_PROJECT_ROLES = ['Manager', 'Member', 'Viewer'];

export const WORKSPACE_ROLE_SUMMARY = {
  Admin: 'Manages accounts, roles and organisation settings; can open and manage every project.',
  Lead: 'Creates projects and becomes their owner, even when project creation is limited to leads.',
  Member: 'Creates projects (unless an admin limits that to leads), joins open projects and works in projects they belong to.',
};

export const PROJECT_ROLE_SUMMARY = {
  Owner: 'Full control, including deleting the project and transferring ownership.',
  Manager: 'Edits the project, runs sprints, deletes tasks, and adds or removes members and viewers.',
  Member: 'Creates, edits, assigns and moves tasks, plans them into sprints, and comments.',
  Viewer: 'Read-only: can view the project and comment, but not change tasks.',
};

/** Organisation setting: who may create projects. */
export const PROJECT_CREATION = ['everyone', 'leads'];
export const PROJECT_CREATION_LABELS = { everyone: 'Everyone', leads: 'Leads and admins only' };
export const DEFAULT_WORKSPACE_SETTINGS = Object.freeze({ projectCreation: 'everyone' });

/** Project visibility: Private projects are invite-only; anyone in the organisation can find and join an Open one. */
export const PROJECT_VISIBILITIES = ['private', 'open'];
export const PROJECT_VISIBILITY_SUMMARY = {
  private: 'Only people who are added can see it.',
  open: 'Anyone in the organisation can find it and join as a member.',
};

const MATRIX = {
  'project.view': ['Owner', 'Manager', 'Member', 'Viewer'],
  'project.export': ['Owner', 'Manager', 'Member', 'Viewer'],
  'project.edit': ['Owner', 'Manager'],
  'project.delete': ['Owner'],
  'project.key': ['Owner'],
  'project.transfer': ['Owner'],
  'members.manage': ['Owner', 'Manager'],
  'members.manageManagers': ['Owner'],
  'task.create': ['Owner', 'Manager', 'Member'],
  'task.edit': ['Owner', 'Manager', 'Member'],
  'task.delete': ['Owner', 'Manager'],
  'sprint.manage': ['Owner', 'Manager'],
  'task.status': ['Owner', 'Manager', 'Member'],
  'task.assignable': ['Owner', 'Manager', 'Member'],
  'comment.create': ['Owner', 'Manager', 'Member', 'Viewer'],
  'comment.moderate': ['Owner', 'Manager'],
};

/** Every action name, in matrix order; used by docs and tests. */
export const PROJECT_ACTIONS = Object.keys(MATRIX);

/** Labels for the permission table shown to users. */
export const PROJECT_ACTION_LABELS = {
  'project.view': 'View project and tasks',
  'project.export': 'Export CSV',
  'project.edit': 'Edit project details',
  'project.delete': 'Delete project',
  'project.key': 'Change the project key',
  'project.transfer': 'Transfer ownership',
  'members.manage': 'Add or remove members and viewers',
  'members.manageManagers': 'Grant or revoke Manager',
  'task.create': 'Create tasks',
  'task.edit': 'Edit and assign tasks',
  'task.delete': 'Delete tasks',
  'sprint.manage': 'Create, start and complete sprints',
  'task.status': 'Change task status',
  'task.assignable': 'Can be assigned tasks',
  'comment.create': 'Comment',
  'comment.moderate': 'Delete anyone’s comment',
};

const ids = (list) => (list ?? []).map(String);

export const isAdmin = (user) => user?.role === 'Admin';
/** Whether `user` may create a project under the organisation's `settings`. */
export function canCreateProject(user, settings = DEFAULT_WORKSPACE_SETTINGS) {
  if (!user || user.active === false || user.deactivatedAt) return false;
  if (user.role === 'Admin' || user.role === 'Lead') return true;
  return (settings?.projectCreation ?? DEFAULT_WORKSPACE_SETTINGS.projectCreation) === 'everyone';
}

/** Whether `user` may add themselves to `project` (Open projects they are not in yet). */
export function canJoinProject(user, project) {
  if (!user || !project || user.active === false || user.deactivatedAt) return false;
  return project.visibility === 'open' && !projectRoleOf(project, user.id);
}
export const canManageAccounts = (user) => isAdmin(user);

/** Project role of `userId` in `project`, or null when they are not a member. */
export function projectRoleOf(project, userId) {
  if (!project || userId == null) return null;
  const id = String(userId);
  if (!ids(project.memberIds).includes(id)) return null;
  if (String(project.ownerId) === id) return 'Owner';
  if (ids(project.managerIds).includes(id)) return 'Manager';
  if (ids(project.viewerIds).includes(id)) return 'Viewer';
  return 'Member';
}

/** Whether a project role is allowed an action (ignores the organisation Admin override). */
export function roleAllows(role, action) {
  return Boolean(role && MATRIX[action]?.includes(role));
}

/**
 * Whether `user` may perform `action` in `project`. Organisation Admins may do everything,
 * except be assigned tasks in a project they are not a member of.
 */
export function can(user, action, project) {
  if (!user || !project || !MATRIX[action]) return false;
  const role = projectRoleOf(project, user.id);
  if (action === 'task.assignable') return roleAllows(role, action);
  if (isAdmin(user)) return true;
  return roleAllows(role, action);
}

/**
 * Whether `actor` may give `targetId` the project role `nextRole` ('Owner' means transfer).
 * Returns null when allowed, otherwise the reason, which the API sends back as the message.
 */
export function memberRoleChangeError(actor, project, targetId, nextRole) {
  const current = projectRoleOf(project, targetId);
  if (!current) return 'That person is not a member of this project.';
  if (!PROJECT_ROLES.includes(nextRole)) return 'Choose Owner, Manager, Member or Viewer.';
  if (nextRole === 'Owner') {
    if (current === 'Owner') return null;
    return can(actor, 'project.transfer', project) ? null : 'Only the project owner or an admin can transfer ownership.';
  }
  if (current === 'Owner') return 'Transfer ownership to someone else before changing the owner’s role.';
  if (!can(actor, 'members.manage', project)) return 'Only the project owner, a manager or an admin can change roles.';
  if ((nextRole === 'Manager' || current === 'Manager') && !can(actor, 'members.manageManagers', project)) {
    return 'Only the project owner or an admin can grant or revoke Manager.';
  }
  return null;
}

/** Whether `actor` may remove `targetId` from `project`. Returns null when allowed, else the reason. */
export function memberRemovalError(actor, project, targetId) {
  const current = projectRoleOf(project, targetId);
  if (!current) return 'That person is not a member of this project.';
  if (current === 'Owner') return 'The project owner cannot be removed. Transfer ownership first.';
  // Anyone may leave a project they belong to.
  if (actor && String(actor.id) === String(targetId)) return null;
  if (!can(actor, 'members.manage', project)) return 'Only the project owner, a manager or an admin can remove members.';
  if (current === 'Manager' && !can(actor, 'members.manageManagers', project)) {
    return 'Only the project owner or an admin can remove a manager.';
  }
  return null;
}

/** Project roles `actor` may pick for `targetId` in the members dialog (including the current one). */
export function grantableRolesFor(actor, project, targetId) {
  return PROJECT_ROLES.filter((role) => role === projectRoleOf(project, targetId)
    || memberRoleChangeError(actor, project, targetId, role) === null);
}

/** Roles `actor` may give someone they add to the project. */
export function rolesForNewMember(actor, project) {
  if (!can(actor, 'members.manage', project)) return [];
  return GRANTABLE_PROJECT_ROLES.filter((role) => role !== 'Manager' || can(actor, 'members.manageManagers', project));
}

/**
 * The membership arrays after giving `targetId` the role `nextRole`. Pure, so the API and the
 * mock API apply exactly the same change. For 'Owner' the previous owner becomes a Manager.
 */
export function withMemberRole(project, targetId, nextRole) {
  const id = String(targetId);
  const without = (list) => ids(list).filter((value) => value !== id);
  let ownerId = String(project.ownerId);
  let managerIds = without(project.managerIds);
  const viewerIds = without(project.viewerIds);
  const memberIds = ids(project.memberIds).includes(id) ? ids(project.memberIds) : [...ids(project.memberIds), id];
  if (nextRole === 'Owner') {
    if (ownerId !== id) managerIds = [...managerIds.filter((value) => value !== ownerId), ownerId];
    ownerId = id;
  } else if (nextRole === 'Manager') managerIds = [...managerIds, id];
  else if (nextRole === 'Viewer') viewerIds.push(id);
  return { ownerId, memberIds, managerIds, viewerIds };
}

/** The membership arrays after removing `targetId`. */
export function withoutMember(project, targetId) {
  const id = String(targetId);
  const without = (list) => ids(list).filter((value) => value !== id);
  return {
    memberIds: without(project.memberIds),
    managerIds: without(project.managerIds),
    viewerIds: without(project.viewerIds),
  };
}
