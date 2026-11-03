'use client';

import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';

/** Project membership (TM-F-021). Only the lead/admin sees add and remove controls. */
export function MembersDialog({ open, onOpenChange, project, canManage, onMembersChange }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  async function add(event) {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter the email of a registered user.');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const members = await api.members.add(project.id, email.trim());
      onMembersChange(members);
      setEmail('');
      toast.success('Member added.');
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.email ? err.fields.email : describeError(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove(member) {
    setRemovingId(member.id);
    try {
      const members = await api.members.remove(project.id, member.id);
      onMembersChange(members, member.id);
      toast.success(`${member.name} was removed and unassigned from this project's tasks.`);
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Members" description={`${project.members.length} people can see and work on ${project.name}.`}>
      <ul className="member-list">
        {project.members.map((member) => (
          <li key={member.id} className="member-row">
            <Avatar user={member} />
            <span className="member-text">
              <span className="member-name">{member.name}</span>
              <span className="member-email">{member.email}</span>
            </span>
            <span className="member-role">{member.id === project.ownerId ? 'Owner' : member.role}</span>
            {canManage && member.id !== project.ownerId ? (
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${member.name}`} loading={removingId === member.id} onClick={() => remove(member)}>
                <UserMinus size={15} />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form className="member-add" noValidate onSubmit={add}>
          <Field label="Add a registered user" error={error} hint="They will see this project and can be assigned tasks.">
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
          <Button type="submit" variant="primary" loading={adding}>
            Add member
          </Button>
        </form>
      ) : null}
    </Modal>
  );
}
