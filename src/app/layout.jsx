import { Geist } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Providers } from '@/components/Providers';
import { APP_NAME } from '@/lib/brand';
import './globals.css';
import '@/components/ui/ui.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export const metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Task Manager Application v1.0: projects, a shared Kanban board and team notifications.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f3f0' },
    { media: '(prefers-color-scheme: dark)', color: '#111214' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        <Providers>{children}</Providers>
        {/* Vercel-only: elsewhere its script path does not exist and would 404 on every page. */}
        {process.env.VERCEL ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
