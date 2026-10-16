'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Bell, FolderKanban, LayoutDashboard, ListChecks, LogOut, Menu as MenuIcon, RotateCcw, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { APP_NAME } from '@/lib/brand';
import { apiConfig, resetMockData } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { useWorkspace } from '@/lib/workspace';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Skeleton } from '@/components/ui/States';
import { Wordmark } from './Wordmark';
import './shell.css';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/tasks', label: 'My tasks', icon: ListChecks },
  { href: '/notifications', label: 'Notifications', icon: Bell, badge: 'unread' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, exact: true },
];

function isActive(pathname, item) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarContent({ onNavigate }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const { projects, unreadCount, clear } = useWorkspace();

  const handleSignOut = () => {
    signOut();
    clear();
    router.replace('/login');
  };

  const handleReset = async () => {
    await resetMockData();
    toast.success('Demo data reset to the fixtures.');
    handleSignOut();
  };

  return (
    <div className="sidebar-inner">
      <Link href="/dashboard" className="sidebar-brand" onClick={onNavigate}>
        <Wordmark />
      </Link>

      <nav aria-label="Main" className="sidebar-nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} className="nav-link" aria-current={active ? 'page' : undefined} onClick={onNavigate}>
              <Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge === 'unread' && unreadCount > 0 ? (
                <span className="count-badge" aria-label={`${unreadCount} unread`}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-section">
        <p className="sidebar-heading" id="sidebar-projects">
          Your projects
        </p>
        <ul className="sidebar-projects" aria-labelledby="sidebar-projects">
          {projects === null
            ? [0, 1].map((i) => (
                <li key={i} className="sidebar-project-skeleton">
                  <Skeleton width="70%" height={12} />
                </li>
              ))
            : projects.map((project) => {
                const href = `/projects/${project.id}`;
                const active = pathname === href;
                return (
                  <li key={project.id}>
                    <Link href={href} className="project-link" aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                      <span className="project-dot" data-seed={project.id.length % 5} aria-hidden="true" />
                      <span className="project-link-name">{project.name}</span>
                    </Link>
                  </li>
                );
              })}
          {projects?.length === 0 ? <li className="sidebar-empty">No projects yet</li> : null}
        </ul>
      </div>

      <div className="sidebar-footer">
        <Menu
          align="start"
          trigger={
            <button type="button" className="user-card" aria-label="Account menu">
              <Avatar user={user} />
              <span className="user-card-text">
                <span className="user-card-name">{user?.name}</span>
                <span className="user-card-role">{user?.role}</span>
              </span>
            </button>
          }
          items={[
            { label: 'Profile', icon: UserRound, onSelect: () => router.push('/profile') },
            apiConfig.mode === 'mock' ? { label: 'Reset demo data', icon: RotateCcw, onSelect: handleReset } : null,
            { separator: true },
            { label: 'Sign out', icon: LogOut, onSelect: handleSignOut },
          ]}
        />
      </div>
    </div>
  );
}

export function AppShell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const status = useSession((s) => s.status);
  const { loadProjects, loadUnread } = useWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    loadProjects();
    loadUnread();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadUnread();
    }, 60_000);
    return () => clearInterval(timer);
  }, [status, loadProjects, loadUnread]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (status !== 'authenticated') {
    return (
      <div className="shell-loading" role="status" aria-label="Loading your workspace">
        <Wordmark />
        <span className="shell-loading-bar" />
      </div>
    );
  }

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="sidebar" aria-label="Sidebar">
        <SidebarContent />
      </aside>

      <header className="topbar">
        <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Dialog.Trigger render={<Button variant="ghost" iconOnly aria-label="Open navigation" />}>
            <MenuIcon size={20} />
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="dialog-backdrop" />
            <Dialog.Popup className="drawer-popup" aria-label="Navigation">
              <Dialog.Close render={<Button variant="ghost" iconOnly size="sm" className="drawer-close" aria-label="Close navigation" />}>
                <X size={18} />
              </Dialog.Close>
              <SidebarContent onNavigate={() => setDrawerOpen(false)} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        <Link href="/dashboard" className="topbar-brand" aria-label={`${APP_NAME} dashboard`}>
          <Wordmark />
        </Link>
        <Link href="/notifications" className="btn topbar-bell" data-variant="ghost" data-icon-only aria-label="Notifications">
          <span className="btn-label">
            <Bell size={20} />
          </span>
          <UnreadDot />
        </Link>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function UnreadDot() {
  const unreadCount = useWorkspace((s) => s.unreadCount);
  return unreadCount > 0 ? <span className="unread-dot" aria-label={`${unreadCount} unread`} /> : null;
}
