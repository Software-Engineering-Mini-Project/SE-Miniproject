// The shared authorization module used by the API, the mock API and the UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_ACTIONS,
  PROJECT_ACTION_LABELS,
  can,
  canCreateProject,
  canJoinProject,
  grantableRolesFor,
  memberRemovalError,
  memberRoleChangeError,
  projectRoleOf,
  rolesForNewMember,
  withMemberRole,
  withoutMember,
} from '../src/lib/permissions.js';

const project = {
  ownerId: 'owner',
  memberIds: ['owner', 'manager', 'member', 'viewer'],
  managerIds: ['manager'],
  viewerIds: ['viewer'],
};
const user = (id, role = 'Member') => ({ id, role });

test('project roles come from the membership arrays; non-members have none', () => {
  assert.equal(projectRoleOf(project, 'owner'), 'Owner');
  assert.equal(projectRoleOf(project, 'manager'), 'Manager');
  assert.equal(projectRoleOf(project, 'member'), 'Member');
  assert.equal(projectRoleOf(project, 'viewer'), 'Viewer');
  assert.equal(projectRoleOf(project, 'stranger'), null);
  // Older projects without role arrays: everyone but the owner is a Member.
  assert.equal(projectRoleOf({ ownerId: 'a', memberIds: ['a', 'b'] }, 'b'), 'Member');
});

test('the permission matrix', () => {
  const expected = {
    owner: PROJECT_ACTIONS,
    manager: PROJECT_ACTIONS.filter((action) => !['project.delete', 'project.key', 'project.transfer', 'members.manageManagers'].includes(action)),
    member: ['project.view', 'project.export', 'task.create', 'task.edit', 'task.status', 'task.assignable', 'comment.create'],
    viewer: ['project.view', 'project.export', 'comment.create'],
    stranger: [],
  };
  for (const [id, actions] of Object.entries(expected)) {
    assert.deepEqual(PROJECT_ACTIONS.filter((action) => can(user(id), action, project)), actions, id);
  }
  // A workspace Lead gets nothing extra inside a project; an Admin gets everything except assignment.
  assert.equal(can(user('stranger', 'Lead'), 'project.view', project), false);
  assert.deepEqual(PROJECT_ACTIONS.filter((action) => !can(user('admin', 'Admin'), action, project)), ['task.assignable']);
  assert.equal(can(user('owner'), 'no.such.action', project), false);
  assert.equal(can(null, 'project.view', project), false);
  assert.ok(PROJECT_ACTIONS.every((action) => PROJECT_ACTION_LABELS[action]));
});

test('project creation follows the workspace setting; Leads and Admins can always create', () => {
  for (const role of ['Admin', 'Lead', 'Member']) assert.equal(canCreateProject(user('a', role)), true, `${role}, default setting`);
  const leadsOnly = { projectCreation: 'leads' };
  assert.equal(canCreateProject(user('a', 'Admin'), leadsOnly), true);
  assert.equal(canCreateProject(user('a', 'Lead'), leadsOnly), true);
  assert.equal(canCreateProject(user('a', 'Member'), leadsOnly), false);
  assert.equal(canCreateProject({ id: 'a', role: 'Admin', active: false }), false, 'deactivated accounts create nothing');
  assert.equal(canCreateProject(null), false);
  assert.equal(canCreateProject(user('a', 'Member'), {}), true, 'missing settings fall back to the default');
});

test('joining: only open projects, only when not already in them', () => {
  const open = { ...project, visibility: 'open' };
  assert.equal(canJoinProject(user('stranger'), open), true);
  assert.equal(canJoinProject(user('member'), open), false, 'already a member');
  assert.equal(canJoinProject(user('stranger'), project), false, 'private');
  assert.equal(canJoinProject(user('stranger'), { ...project, visibility: undefined }), false, 'missing visibility means private');
  assert.equal(canJoinProject(null, open), false);
  assert.equal(canJoinProject({ id: 'stranger', role: 'Member', deactivatedAt: '2026-01-01' }, open), false);
});

test('role changes: who may grant what', () => {
  const owner = user('owner');
  const manager = user('manager');
  assert.equal(memberRoleChangeError(owner, project, 'member', 'Manager'), null);
  assert.equal(memberRoleChangeError(owner, project, 'member', 'Owner'), null);
  assert.match(memberRoleChangeError(manager, project, 'member', 'Manager'), /grant or revoke Manager/);
  assert.equal(memberRoleChangeError(manager, project, 'member', 'Viewer'), null);
  assert.match(memberRoleChangeError(manager, project, 'owner', 'Member'), /Transfer ownership/);
  assert.match(memberRoleChangeError(manager, project, 'member', 'Owner'), /transfer ownership/);
  assert.match(memberRoleChangeError(user('member'), project, 'viewer', 'Member'), /change roles/);
  assert.match(memberRoleChangeError(owner, project, 'stranger', 'Member'), /not a member/);
  assert.match(memberRoleChangeError(owner, project, 'member', 'Admin'), /Choose/);

  assert.deepEqual(grantableRolesFor(owner, project, 'member'), ['Owner', 'Manager', 'Member', 'Viewer']);
  assert.deepEqual(grantableRolesFor(manager, project, 'member'), ['Member', 'Viewer']);
  assert.deepEqual(grantableRolesFor(manager, project, 'owner'), ['Owner']);
  assert.deepEqual(rolesForNewMember(owner, project), ['Manager', 'Member', 'Viewer']);
  assert.deepEqual(rolesForNewMember(manager, project), ['Member', 'Viewer']);
  assert.deepEqual(rolesForNewMember(user('viewer'), project), []);
});

test('removals: anyone but the owner may leave; managers can only be removed by the owner', () => {
  assert.equal(memberRemovalError(user('viewer'), project, 'viewer'), null);
  assert.equal(memberRemovalError(user('manager'), project, 'manager'), null);
  assert.match(memberRemovalError(user('owner'), project, 'owner'), /cannot be removed/);
  assert.match(memberRemovalError(user('member'), project, 'viewer'), /remove members/);
  assert.match(memberRemovalError(user('manager'), project, 'manager2'), /not a member/);
  assert.equal(memberRemovalError(user('manager'), project, 'member'), null);
  const twoManagers = { ...project, memberIds: [...project.memberIds, 'm2'], managerIds: ['manager', 'm2'] };
  assert.match(memberRemovalError(user('manager'), twoManagers, 'm2'), /remove a manager/);
  assert.equal(memberRemovalError(user('admin', 'Admin'), twoManagers, 'm2'), null);
});

test('membership updates are pure and keep the arrays consistent', () => {
  assert.deepEqual(withMemberRole(project, 'member', 'Viewer'), {
    ownerId: 'owner', memberIds: project.memberIds, managerIds: ['manager'], viewerIds: ['viewer', 'member'],
  });
  assert.deepEqual(withMemberRole(project, 'viewer', 'Member').viewerIds, []);
  assert.deepEqual(withMemberRole(project, 'new', 'Manager').memberIds, [...project.memberIds, 'new']);
  const transferred = withMemberRole(project, 'viewer', 'Owner');
  assert.equal(transferred.ownerId, 'viewer');
  assert.deepEqual(transferred.managerIds, ['manager', 'owner']);
  assert.deepEqual(transferred.viewerIds, []);
  assert.deepEqual(withoutMember(project, 'manager'), {
    memberIds: ['owner', 'member', 'viewer'], managerIds: [], viewerIds: ['viewer'],
  });
  assert.deepEqual(project.managerIds, ['manager'], 'input is not mutated');
});
