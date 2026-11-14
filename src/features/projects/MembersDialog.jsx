'use client';

import { useState } from 'react';
import { Check, LogOut, Minus, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import {
  PROJECT_ACTIONS,
  PROJECT_ACTION_LABELS,
  PROJECT_ROLES,
  PROJECT_ROLE_SUMMARY,
  grantableRolesFor,
  memberRemovalError,
  projectRoleOf,
  roleAllows,
  rolesForNewMember,
} from '@/lib/permissions';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';

/** What each project role may do, from the same matrix the API enforces. */
function RoleGuide() {
  return (
    <details className="role-guide">
      <summary>What can each role do?</summary>
      <dl className="role-guide-summaries">
        {PROJECT_ROLES.map((role) => (
          <div key={role}>
            <dt>{role}</dt>
            <dd>{PROJECT_ROLE_SUMMARY[role]}</dd>
          </div>
        ))}
      </dl>
      <div className="role-guide-scroll">
        <table className="role-guide-table">
          <caption className="visually-hidden">Permissions by project role</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              {PROJECT_ROLES.map((role) => (
                <th key={role} scope="col">{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROJECT_ACTIONS.map((action) => (
              <tr key={action}>
                <th scope="row">{PROJECT_ACTION_LABELS[action]}</th>
                {PROJECT_ROLES.map((role) => (
                  <td key={role}>
                    {roleAllows(role, action) ? (
                      <Check size={14} aria-label="Allowed" className="role-yes" />
                    ) : (
                      <Minus size={14} aria-label="Not allowed" className="role-no" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="role-guide-note">Organisation admins can do everything in every project.</p>
    </details>
  );
}

/** Project membership and roles (TM-F-021). Controls appear only where the API would allow them. */
export function MembersDialog({ open, onOpenChange, project, onMembersChange }) {
  const user = useSession((s) => s.user);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState('Member');
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // { id, kind: 'remove' | 'transfer' } while an inline confirmation is open.
  const [confirming, setConfirming] = useState(null);

  const addRoles = rolesForNewMember(user, project);
  const myRole = projectRoleOf(project, user?.id);
  const canLeave = Boolean(myRole) && memberRemovalError(user, project, user?.id) === null;

  async function add(event) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter the email of a registered user.');
      return;
    }
    const wanted = email.trim().toLowerCase();
    const existing = project.members.find((m) => m.email?.toLowerCase() === wanted);
    if (existing) {
      setError(`${existing.name} is already a member.`);
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const role = addRoles.includes(newRole) ? newRole : 'Member';
      const members = await api.members.add(project.id, email.trim(), role);
      const added = members.find((m) => !project.members.some((old) => old.id === m.id));
      onMembersChange(members);
      setEmail('');
      if (added) toast.success(`${added.name} was added to ${project.name} as ${role === 'Member' ? 'a member' : `a ${role.toLowerCase()}`}.`);
      else toast.info('That user is already a member.');
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.email ? err.fields.email : describeError(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(member) {
    setConfirming(null);
    setBusyId(member.id);
    try {
      const members = await api.members.remove(project.id, member.id);
      onMembersChange(members, { removedId: member.id });
      if (member.id !== user?.id) toast.success(`${member.name} was removed and unassigned from this project's tasks.`);
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(member, role) {
    setConfirming(null);
    setBusyId(member.id);
    try {
      const members = await api.members.setRole(project.id, member.id, role);
      onMembersChange(members, role === 'Viewer' ? { unassignedId: member.id } : undefined);
      toast.success(role === 'Owner'
        ? `${member.name} now owns ${project.name}. You are a manager.`
        : `${member.name} is now ${role === 'Member' ? 'a member' : `a ${role.toLowerCase()}`}${role === 'Viewer' ? ' and was unassigned from tasks' : ''}.`);
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  const owner = project.members.find((m) => m.id === project.ownerId);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Members" description={`${project.members.length} people can see ${project.name}.`}>
      <ul className="member-list">
        {project.members.map((member) => {
          const role = member.projectRole ?? projectRoleOf(project, member.id);
          const options = grantableRolesFor(user, project, member.id);
          const removable = member.id !== user?.id && memberRemovalError(user, project, member.id) === null;
          const isMe = member.id === user?.id;
          return (
            <li key={member.id} className="member-row" data-inactive={member.active === false || undefined}>
              <Avatar user={member} />
              <span className="member-text">
                <span className="member-name">
                  {member.name}
                  {isMe ? <span className="member-you">You</span> : null}
                  {member.active === false ? <span className="member-flag">Deactivated</span> : null}
                </span>
                <span className="member-email">{member.email}</span>
              </span>
              {confirming?.id === member.id && confirming.kind !== 'leave' ? (
                <span
                  className="member-confirm"
                  role="group"
                  aria-label={confirming.kind === 'transfer' ? `Confirm making ${member.name} the owner` : `Confirm removing ${member.name}`}
                >
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  {confirming.kind === 'transfer' ? (
                    <Button variant="primary" size="sm" autoFocus onClick={() => changeRole(member, 'Owner')}>
                      Transfer
                    </Button>
                  ) : (
                    <Button variant="danger" size="sm" autoFocus onClick={() => remove(member)}>
                      Remove
                    </Button>
                  )}
                </span>
              ) : (
                <span className="member-controls">
                  {options.length > 1 ? (
                    <>
                      <label className="visually-hidden" htmlFor={`project-role-${member.id}`}>
                        Project role for {member.name}
                      </label>
                      <select
                        id={`project-role-${member.id}`}
                        className="select select-compact member-role-select"
                        value={role}
                        disabled={busyId === member.id}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (next === 'Owner') setConfirming({ id: member.id, kind: 'transfer' });
                          else changeRole(member, next);
                        }}
                      >
                        {options.map((option) => (
                          <option key={option} value={option}>
                            {option === 'Owner' && role !== 'Owner' ? 'Owner (transfer)' : option}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <span className="role-badge" data-role={role?.toLowerCase()}>
                      {role}
                    </span>
                  )}
                  {removable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Remove ${member.name}`}
                      loading={busyId === member.id}
                      onClick={() => setConfirming({ id: member.id, kind: 'remove' })}
                    >
                      <UserMinus size={15} />
                    </Button>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {confirming?.kind === 'transfer' ? (
        <p className="member-transfer-note" role="status">
          The new owner gets full control, including deleting the project. {owner?.id === user?.id ? 'You' : owner?.name} will become a manager.
        </p>
      ) : null}

      {addRoles.length ? (
        <form className="member-add" noValidate onSubmit={add}>
          <Field label="Add a registered user" error={error} hint="Members can move tasks; viewers can only read and comment.">
            <input
              className="input"
              type="email"
              placeholder="name@example.test"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <label className="visually-hidden" htmlFor="member-add-role">
            Role for the new member
          </label>
          <select id="member-add-role" className="select member-add-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {addRoles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" loading={adding}>
            Add member
          </Button>
        </form>
      ) : null}

      <div className="member-footer">
        <RoleGuide />
        {canLeave ? (
          confirming?.kind === 'leave' ? (
            <span className="member-confirm" role="group" aria-label="Confirm leaving the project">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Stay
              </Button>
              <Button variant="danger" size="sm" autoFocus onClick={() => remove(project.members.find((m) => m.id === user.id))}>
                Leave
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming({ id: user.id, kind: 'leave' })}>
              <LogOut size={14} /> Leave project
            </Button>
          )
        ) : null}
      </div>
    </Modal>
  );
}
