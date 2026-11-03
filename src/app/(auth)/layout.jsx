import Link from 'next/link';
import { Wordmark } from '@/components/shell/Wordmark';
import { AuthShowcase } from '@/features/auth/AuthShowcase';
import '@/features/auth/auth.css';
import '@/components/shell/shell.css';

export default function AuthLayout({ children }) {
  return (
    <div className="auth">
      <div className="auth-form-side">
        <Link href="/" className="auth-brand">
          <Wordmark />
        </Link>
        <main className="auth-main">{children}</main>
        <p className="auth-footnote">Task Manager Application v1.0 · SE mini-project</p>
      </div>
      <AuthShowcase />
    </div>
  );
}
