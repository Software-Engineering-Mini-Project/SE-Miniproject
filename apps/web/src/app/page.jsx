import { redirect } from 'next/navigation';

// The app shell sends signed-out visitors on to /login.
export default function HomePage() {
  redirect('/dashboard');
}
