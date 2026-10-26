'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { PageHeader } from '@/components/shell/PageHeader';
import { PasswordInput } from '@/features/auth/PasswordInput';
import '@/features/auth/auth.css';
import '@/features/dashboard/dashboard.css';

/** Profile name and password change (TM-F-003). */
export function ProfilePage() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState(user?.name || '');
  const [nameError, setNameError] = useState(null);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwErrors, setPwErrors] = useState({});
  const [savingPw, setSavingPw] = useState(false);

  async function saveName(event) {
    event.preventDefault();
    if (!name.trim()) return setNameError('Enter your name.');
    if (name.trim().length > LIMITS.nameMax) return setNameError(`Use ${LIMITS.nameMax} characters or fewer.`);
    setSavingName(true);
    try {
      const updated = await api.users.updateMe({ name: name.trim() });
      setUser(updated);
      toast.success('Name updated.');
    } catch (error) {
      setNameError(error instanceof ApiError && error.fields?.name ? error.fields.name : describeError(error));
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    const errors = {};
    if (!pw.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (pw.newPassword.length < LIMITS.passwordMin || !/[A-Za-z]/.test(pw.newPassword) || !/\d/.test(pw.newPassword)) {
      errors.newPassword = 'Use 8+ characters with a letter and a number.';
    }
    setPwErrors(errors);
    if (Object.keys(errors).length) return;
    setSavingPw(true);
    try {
      await api.users.updateMe(pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed. Use it next time you sign in.');
    } catch (error) {
      if (error instanceof ApiError && error.fields) setPwErrors(error.fields);
      else toast.error(describeError(error));
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <>
      <PageHeader title="Profile" description="Your name is shown on tasks, comments and the board." />
      <div className="profile-grid">
        <form className="panel profile-card" noValidate onSubmit={saveName}>
          <div className="profile-identity">
            <Avatar user={user} size="lg" />
            <span className="profile-identity-text">
              <strong>{user?.name}</strong>
              <span>
                {user?.email} · {user?.role}
              </span>
              {user?.createdAt ? <span>Member since {formatDate(user.createdAt)}</span> : null}
            </span>
          </div>
          <Field label="Display name" error={nameError}>
            <input
              className="input"
              value={name}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
            />
          </Field>
          <Button type="submit" variant="primary" loading={savingName} disabled={name.trim() === user?.name}>
            Save name
          </Button>
        </form>

        <form className="panel profile-card" noValidate onSubmit={savePassword}>
          <h2>Change password</h2>
          <Field label="Current password" error={pwErrors.currentPassword}>
            <PasswordInput
              autoComplete="current-password"
              value={pw.currentPassword}
              onChange={(e) => {
                setPw((v) => ({ ...v, currentPassword: e.target.value }));
                setPwErrors((er) => ({ ...er, currentPassword: undefined }));
              }}
            />
          </Field>
          <Field label="New password" error={pwErrors.newPassword} hint="At least 8 characters, with a letter and a number.">
            <PasswordInput
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => {
                setPw((v) => ({ ...v, newPassword: e.target.value }));
                setPwErrors((er) => ({ ...er, newPassword: undefined }));
              }}
            />
          </Field>
          <Button type="submit" loading={savingPw}>
            Change password
          </Button>
        </form>
      </div>
    </>
  );
}
