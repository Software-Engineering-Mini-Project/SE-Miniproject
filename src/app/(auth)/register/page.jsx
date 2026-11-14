import { RegisterForm } from '@/features/auth/RegisterForm';

export const metadata = { title: 'Create account' };

// `/register?invite=...` is a personal invitation link (issue #78).
export default async function RegisterPage({ searchParams }) {
  const { invite } = await searchParams;
  return <RegisterForm inviteToken={typeof invite === 'string' && invite ? invite : null} />;
}
