'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Info } from 'lucide-react';
import { apiConfig } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { PasswordInput } from './PasswordInput';

const DEMO_ACCOUNTS = [
  { role: 'Lead', email: 'lead@example.test', note: 'Manages Alpha' },
  { role: 'Member', email: 'member@example.test', note: 'Works on Alpha' },
  { role: 'Admin', email: 'admin@example.test', note: 'Owns Beta' },
  { role: 'Outsider', email: 'outsider@example.test', note: 'No projects' },
];
const DEMO_PASSWORD = 'Password123!';

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn, status, reason } = useSession();
  const [values, setValues] = useState({ email: params.get('email') || '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, router, next]);

  const update = (key) => (event) => {
    setValues((v) => ({ ...v, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(credentials) {
    const nextErrors = {};
    if (!credentials.email.trim()) nextErrors.email = 'Enter your email.';
    if (!credentials.password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await signIn(credentials.email.trim(), credentials.password);
      router.replace(next);
    } catch (error) {
      setFormError(error instanceof ApiError && error.status === 401 ? 'Email or password is incorrect.' : describeError(error));
      setSubmitting(false);
    }
  }

  const fillDemo = (email) => {
    const credentials = { email, password: DEMO_PASSWORD };
    setValues(credentials);
    submit(credentials);
  };

  return (
    <>
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-lede">Pick up where your team left off.</p>

      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(values);
        }}
      >
        {reason === 'expired' && !formError ? (
          <p className="form-alert" data-tone="info" role="status">
            <Info size={16} aria-hidden="true" />
            Your session expired. Sign in again to continue.
          </p>
        ) : null}
        {formError ? (
          <p className="form-alert" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {formError}
          </p>
        ) : null}

        <Field label="Email" error={errors.email}>
          <input
            ref={emailRef}
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={values.email}
            onChange={update('email')}
            autoFocus
          />
        </Field>
        <Field label="Password" error={errors.password}>
          <PasswordInput name="password" autoComplete="current-password" value={values.password} onChange={update('password')} />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Sign in
        </Button>
      </form>

      <p className="auth-alt">
        New here? <Link href="/register">Create an account</Link>
      </p>

      {apiConfig.mode === 'mock' ? (
        <section className="demo-accounts" aria-labelledby="demo-accounts-title">
          <h2 className="demo-accounts-title" id="demo-accounts-title">
            Demo accounts
          </h2>
          <p className="demo-accounts-hint">Synthetic fixture users. Each one signs in with {DEMO_PASSWORD}</p>
          <div className="demo-accounts-list">
            {DEMO_ACCOUNTS.map((account) => (
              <button key={account.email} type="button" className="demo-account" onClick={() => fillDemo(account.email)} disabled={submitting}>
                <span className="demo-account-role">{account.role}</span>
                <span className="demo-account-note">{account.note}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
