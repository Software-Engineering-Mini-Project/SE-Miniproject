'use client';

import { RefreshNotice } from '@/components/ui/RefreshNotice';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, BellOff, CheckCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatRelative } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { useWorkspace } from '@/lib/workspace';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import '@/features/dashboard/dashboard.css';
import '@/features/projects/projects.css';

const ICONS = { assignment: UserPlus, 'due-date': AlarmClock };

/** Own notifications only (TM-F-030, TM-F-031). */
export function NotificationsPage() {
  const router = useRouter();
  const setUnread = useWorkspace((s) => s.setUnread);
  const inbox = useQuery('notifications', async () => {
    const page = await api.notifications.list(1);
    setUnread(page.unreadCount);
    return page;
  });
  const [filter, setFilter] = useState('all');
  const [markingAll, setMarkingAll] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const items = inbox.data?.items || [];
  const unread = items.filter((n) => !n.read);
  const shown = filter === 'unread' ? unread : items;
  // The server count covers every page, not just the ones loaded so far.
  const unreadTotal = inbox.data?.unreadCount ?? unread.length;
  const hasMore = Boolean(inbox.data && items.length < inbox.data.total);

  const markLocal = (ids, { all = false } = {}) => {
    const newlyRead = unread.filter((n) => ids.includes(n.id)).length;
    const nextUnread = all ? 0 : Math.max(0, unreadTotal - newlyRead);
    inbox.setData((page) => ({
      ...page,
      unreadCount: nextUnread,
      items: page.items.map((n) => (all || ids.includes(n.id) ? { ...n, read: true } : n)),
    }));
    setUnread(nextUnread);
  };

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await api.notifications.list((inbox.data.page || 1) + 1);
      inbox.setData((page) => {
        const seen = new Set(page.items.map((n) => n.id));
        return { ...next, items: [...page.items, ...next.items.filter((n) => !seen.has(n.id))] };
      });
      setUnread(next.unreadCount);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function open(notification) {
    if (!notification.read) {
      markLocal([notification.id]);
      api.notifications.markRead(notification.id).catch(() => inbox.reload());
    }
    if (notification.projectId) router.push(`/projects/${notification.projectId}?task=${encodeURIComponent(notification.taskId)}`);
    else toast.info('The task for this notification is no longer available.');
  }

  async function markAll() {
    setMarkingAll(true);
    const ids = unread.map((n) => n.id);
    try {
      await api.notifications.markAllRead();
      markLocal(ids, { all: true });
      toast.success('All caught up.');
    } catch (error) {
      toast.error(describeError(error));
      inbox.reload();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <PageHeader title="Notifications" description="Assignments and due-date reminders for your tasks." />

      <div className="notif-toolbar">
        <div className="view-toggle" role="group" aria-label="Show">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
          <button type="button" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread{unreadTotal ? ` (${unreadTotal})` : ''}
          </button>
        </div>
        <Button size="sm" onClick={markAll} loading={markingAll} disabled={!unreadTotal}>
          <CheckCheck size={15} /> Mark all as read
        </Button>
      </div>

      {inbox.error && inbox.data && <RefreshNotice onRetry={inbox.reload} />}
      {inbox.error && !inbox.data ? (
        <ErrorState error={inbox.error} onRetry={inbox.reload} />
      ) : !inbox.data ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={68} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={filter === 'unread' ? (unreadTotal ? 'Your unread notifications are further down' : 'No unread notifications') : 'No notifications yet'}
        >
          You are notified when someone assigns you a task or one of your tasks is due within 24 hours.
        </EmptyState>
      ) : (
        <ul className="notif-list">
          {shown.map((n) => {
            const Icon = ICONS[n.type] || UserPlus;
            return (
              <li key={n.id}>
                <button type="button" className="notif-item" data-unread={!n.read || undefined} data-type={n.type} onClick={() => open(n)}>
                  <span className="notif-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="notif-text">
                    <span className="notif-message">{n.message}</span>
                    <time className="notif-time" dateTime={n.createdAt}>
                      {n.type === 'due-date' ? 'Reminder' : 'Assignment'} · {formatRelative(n.createdAt)}
                    </time>
                  </span>
                  {!n.read ? <span className="notif-unread-dot" aria-label="Unread" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <div className="list-more">
          <span className="list-more-count">
            Showing {items.length} of {inbox.data.total}
          </span>
          <Button size="sm" onClick={loadMore} loading={loadingMore}>
            Load older notifications
          </Button>
        </div>
      ) : null}
    </>
  );
}
