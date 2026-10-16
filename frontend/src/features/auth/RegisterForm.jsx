'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { LIMITS } from '@/lib/constants';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { PasswordInput } from './PasswordInput';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Client checks mirror the API rules for fast feedback; the API remains authoritative (TM-F-001).
function validate({ name, email, password }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Enter your name.';
  else if (name.trim().length > LIMITS.nameMax) errors.name = `Use ${LIMITS.nameMax} characters or fewer.`;
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (password.length < LIMITS.passwordMin || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Use 8+ characters with a letter and a number.';
  }
  return errors;
}

export function RegisterForm() {
  const router = useRouter();
  const signIn = useSession((s) => s.signIn);
  const [values, setValues] = useState({ name: '', email: '', password: '' });
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
      await api.auth.register({ name: values.name.trim(), email: values.email.trim(), password: values.password });
      await signIn(values.email.trim(), values.password);
      toast.success('Account created. Welcome aboard.');
      router.replace('/dashboard');
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else setFormError(describeError(error));
      if (error instanceof ApiError && error.status === 409) setErrors({ email: 'This email is already registered.' });
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-lede">A project lead adds you to projects after you sign up.</p>

      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        {formError ? (
          <p className="form-alert" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {formError}
          </p>
        ) : null}
        <Field label="Full name" error={errors.name}>
          <input className="input" name="name" autoComplete="name" value={values.name} onChange={update('name')} autoFocus />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="input" type="email" name="email" autoComplete="email" inputMode="email" value={values.email} onChange={update('email')} />
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
