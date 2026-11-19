'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Building2, MailCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { ORGANISATION_NAME_MAX, isJoinCodeShape, normalizeJoinCode } from '@/lib/organisation';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/States';
import { PasswordInput } from './PasswordInput';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Client checks mirror the API rules for fast feedback; the API remains authoritative (TM-F-001).
function validate({ name, email, password, mode, joinCode, organisationName }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Enter your name.';
  else if (name.trim().length > LIMITS.nameMax) errors.name = `Use ${LIMITS.nameMax} characters or fewer.`;
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (password.length < LIMITS.passwordMin || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Use 8+ characters with a letter and a number.';
  }
  if (mode === 'invite') return errors;
  if (mode === 'join') {
    if (!isJoinCodeShape(normalizeJoinCode(joinCode))) errors.joinCode = "Enter your organisation's invite code.";
  } else if (!organisationName.trim()) errors.organisationName = 'Name your organisation.';
  else if (organisationName.trim().length > ORGANISATION_NAME_MAX) errors.organisationName = `Use ${ORGANISATION_NAME_MAX} characters or fewer.`;
  return errors;
}

/**
 * Registration. With `inviteToken` (a personal invitation link, issue #78) the organisation and
 * email are fixed by the invitation; otherwise people join with an invite code or start their own.
 */
export function RegisterForm({ inviteToken = null }) {
  const invitation = useQuery(inviteToken ? `invitation:${inviteToken}` : null, () => api.auth.invitation(inviteToken));
  if (!inviteToken) return <RegisterFields />;
  if (invitation.error) return <InvitationProblem error={invitation.error} />;
  if (!invitation.data) {
    return (
      <div aria-busy="true" aria-label="Checking your invitation">
        <Skeleton height={28} width="60%" />
        <Skeleton height={220} radius="var(--radius-lg)" />
      </div>
    );
  }
  return <RegisterFields invitation={{ ...invitation.data, token: inviteToken }} />;
}

function InvitationProblem({ error }) {
  return (
    <>
      <h1 className="auth-title">This invitation can&apos;t be used</h1>
      <p className="form-alert" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        {describeError(error)}
      </p>
      <p className="auth-alt">
        Already joined? <Link href="/login">Sign in</Link>. Have an invite code? <Link href="/register">Create an account with it</Link>.
      </p>
    </>
  );
}

function RegisterFields({ invitation = null }) {
  const router = useRouter();
  const signIn = useSession((s) => s.signIn);
  const [values, setValues] = useState({ name: '', email: invitation?.email ?? '', password: '', mode: invitation ? 'invite' : 'join', joinCode: '', organisationName: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (event) => {
    setValues((v) => ({ ...v, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const base = { name: values.name.trim(), email: values.email.trim(), password: values.password };
      await api.auth.register(values.mode === 'invite'
        ? { ...base, inviteToken: invitation.token }
        : values.mode === 'join'
          ? { ...base, joinCode: normalizeJoinCode(values.joinCode) }
          : { ...base, organisationName: values.organisationName.trim() });
      await signIn(values.email.trim(), values.password);
      if (values.mode === 'invite') {
        toast.success(`Account created. Welcome to ${invitation.organisation.name}.`);
        router.replace('/dashboard');
      } else if (values.mode === 'join') {
        toast.success('Account created. Welcome aboard.');
        router.replace('/dashboard');
      } else {
        toast.success('Organisation created. Share its invite code to bring your team in.');
        router.replace('/organisation');
      }
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else setFormError(describeError(error));
      if (error instanceof ApiError && error.status === 409) setErrors({ email: 'This email is already registered.' });
      setSubmitting(false);
    }
  }

  return (
    <>
      {invitation ? (
        <>
          <h1 className="auth-title">Join {invitation.organisation.name}</h1>
          <p className="auth-lede">
            <MailCheck size={16} aria-hidden="true" /> You were invited as <strong>{invitation.email}</strong>. Create your account to join as a member. The invitation expires {formatDate(invitation.expiresAt)}.
          </p>
        </>
      ) : (
        <>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-lede">Join your organisation with its invite code, or start a new one for your team.</p>
        </>
      )}

      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        {formError ? (
          <p className="form-alert" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {formError}
          </p>
        ) : null}
        {invitation ? null : (
        <fieldset className="auth-choice">
          <legend>Your organisation</legend>
          {[
            ['join', 'Join an organisation', 'You have an invite code from your admin.', Users],
            ['create', 'Create an organisation', 'Start a new one. You become its admin.', Building2],
          ].map(([value, label, hint, Icon]) => (
            <label key={value} className="auth-choice-option">
              <input
                type="radio"
                name="mode"
                value={value}
                checked={values.mode === value}
                onChange={() => { setValues((v) => ({ ...v, mode: value })); setErrors((e) => ({ ...e, joinCode: undefined, organisationName: undefined })); }}
              />
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                {hint}
              </span>
            </label>
          ))}
        </fieldset>
        )}
        {values.mode === 'invite' ? null : values.mode === 'join' ? (
          <Field label="Invite code" error={errors.joinCode} hint="Ask an admin of your organisation. Capitals and dashes don't matter.">
            <input className="input" name="joinCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={values.joinCode} onChange={update('joinCode')} />
          </Field>
        ) : (
          <Field label="Organisation name" error={errors.organisationName}>
            <input className="input" name="organisationName" autoComplete="organization" maxLength={ORGANISATION_NAME_MAX + 10} value={values.organisationName} onChange={update('organisationName')} />
          </Field>
        )}
        <Field label="Full name" error={errors.name}>
          <input className="input" name="name" autoComplete="name" value={values.name} onChange={update('name')} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" name="email" autoComplete="email" inputMode="email" value={values.email} onChange={update('email')} readOnly={Boolean(invitation)} />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number.">
          <PasswordInput name="password" autoComplete="new-password" value={values.password} onChange={update('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="auth-alt">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
