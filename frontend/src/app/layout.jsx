import { Geist } from 'next/font/google';
import { APP_NAME } from '@/lib/brand';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export const metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Task Manager Application v1.0: projects, a shared Kanban board and team notifications.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f3f3f0',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
