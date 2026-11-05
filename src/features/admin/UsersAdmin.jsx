'use client';

import { useEffect, useState } from 'react';
import { Search, ShieldCheck, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RefreshNotice } from '@/components/ui/RefreshNotice';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import '@/features/tasks/tasks.css';
import './admin.css';

const ROLES = ['Admin', 'Lead', 'Member'];
const ROLE_HINT = {
  Admin: 'Every project, every user',
  Lead: 'Creates and runs projects',
  Member: 'Works on assigned projects',
};

/** Admin user management (SRS §2.2): find accounts and change roles. */
export function UsersAdmin() {
  const me = useSession((s) => s.user);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const isAdmin = me?.role === 'Admin';
  const users = useQuery(isAdmin ? `admin-users:${role}:${q}` : null, () => api.users.list({ q, role }));

  if (!isAdmin) {
    return (
      <EmptyState icon={ShieldCheck} title="Admins only">
        Ask a workspace admin if you need a different role.
      </EmptyState>
    );
  }

  const data = users.data;
  const items = data?.items || [];
  const hasMore = Boolean(data && items.length < data.total);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await api.users.list({ q, role, page: data.page + 1 });
      users.setData((current) => {
        const seen = new Set(current.items.map((u) => u.id));
        return { ...next, items: [...current.items, ...next.items.filter((u) => !seen.has(u.id))] };
      });
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoadingMore(false);
    }
  }

  async function changeRole(user, nextRole, { undo = false } = {}) {
    if (user.role === nextRole) return;
    setSavingId(user.id);
    try {
      const updated = await api.users.setRole(user.id, nextRole);
      users.setData((current) => {
        const roleCounts = { ...current.roleCounts };
        roleCounts[user.role] = Math.max(0, (roleCounts[user.role] ?? 0) - 1);
        roleCounts[updated.role] = (roleCounts[updated.role] ?? 0) + 1;
        return { ...current, roleCounts, items: current.items.map((u) => (u.id === user.id ? { ...u, ...updated } : u)) };
      });
      const roleName = `${nextRole === 'Admin' ? 'an' : 'a'} ${nextRole}`;
      if (!undo) {
        toast.success(`${user.name} is now ${roleName}.`, {
          action: { label: 'Undo', onClick: () => changeRole({ ...user, role: nextRole }, user.role, { undo: true }) },
        });
      } else {
        toast.success(`${user.name} is ${roleName} again.`);
      }
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setSavingId(null);
    }
  }

  const counts = data?.roleCounts;
  const totalUsers = counts ? ROLES.reduce((sum, r) => sum + counts[r], 0) : 0;

  return (
    <>
      <PageHeader title="Users" description="Everyone with an account. Role changes take effect on their next request; no sign-out needed." />

      {counts ? (
        <dl className="role-summary" aria-label="Accounts by role">
          <div>
            <dt>All accounts</dt>
            <dd>{totalUsers}</dd>
          </div>
          {ROLES.map((r) => (
            <div key={r}>
              <dt>{r}s</dt>
              <dd>{counts[r]}</dd>
              <dd className="role-summary-hint">{ROLE_HINT[r]}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="filters admin-filters" role="search" aria-label="Find users">
        <div className="input-with-icon">
          <Search size={16} aria-hidden="true" />
          <label htmlFor="user-search" className="visually-hidden">
            Search by name or email
          </label>
          <input id="user-search" className="input" type="search" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">Any role</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        {data ? (
          <p className="filters-count" aria-live="polite">
            {plural(data.total, 'user')}
          </p>
        ) : null}
      </div>

      {users.error && users.data ? <RefreshNotice onRetry={users.reload} /> : null}
      {users.error && !users.data ? (
        <ErrorState error={users.error} title="Users did not load" onRetry={users.reload} />
      ) : !data ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={64} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={UsersRound} title="No users match" tone="quiet" />
      ) : (
        <ul className="user-list" aria-label="Users">
          {items.map((user) => {
            const self = user.id === me.id;
            return (
              <li key={user.id} className="user-row">
                <Avatar user={user} />
                <span className="user-row-text">
                  <span className="user-row-name">
                    {user.name}
                    {self ? <span className="user-row-you"> · You</span> : null}
                  </span>
                  <span className="user-row-email">{user.email}</span>
                </span>
                <span className="user-row-meta">
                  <span>{plural(user.projectCount, 'project')}</span>
                  {user.createdAt ? <span>Joined {formatDate(user.createdAt)}</span> : null}
                </span>
                <span className="user-row-role">
                  <label className="visually-hidden" htmlFor={`role-${user.id}`}>
                    Role for {user.name}
                  </label>
                  <select
                    id={`role-${user.id}`}
                    className="select"
                    value={user.role}
                    disabled={self || savingId === user.id}
                    title={self ? 'Another admin has to change your role.' : undefined}
                    onChange={(e) => changeRole(user, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <div className="list-more">
          <span className="list-more-count">
            Showing {items.length} of {data.total}
          </span>
          <Button size="sm" onClick={loadMore} loading={loadingMore}>
            Load more users
          </Button>
        </div>
      ) : null}
    </>
  );
}
