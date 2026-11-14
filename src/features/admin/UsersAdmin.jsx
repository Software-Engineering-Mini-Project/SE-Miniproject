'use client';

import { useEffect, useState } from 'react';
import { Ban, RotateCcw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { describeError } from '@/lib/api/errors';
import { formatDate, plural } from '@/lib/format';
import { invalidateQuery, useQuery } from '@/lib/hooks/useQuery';
import { useSession } from '@/lib/session';
import { DEFAULT_WORKSPACE_SETTINGS, PROJECT_CREATION, PROJECT_CREATION_LABELS, WORKSPACE_ROLE_SUMMARY } from '@/lib/permissions';
import { useWorkspace } from '@/lib/workspace';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RefreshNotice } from '@/components/ui/RefreshNotice';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/shell/PageHeader';
import '@/features/tasks/tasks.css';
import './admin.css';

const ROLES = ['Admin', 'Lead', 'Member'];
const roleHint = (role, settings = DEFAULT_WORKSPACE_SETTINGS) => ({
  Admin: 'Every project, every user',
  Lead: 'Always creates projects',
  Member: settings.projectCreation === 'everyone' ? 'Creates and joins projects' : 'Joins open projects',
})[role];

/** Organisation-wide rules an admin controls (like Jira's global permissions). */
function OrganisationSettings() {
  const loaded = useWorkspace((s) => s.settings);
  const setSettings = useWorkspace((s) => s.setSettings);
  const loadSettings = useWorkspace((s) => s.loadSettings);
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  const [saving, setSaving] = useState(false);
  const settings = loaded ?? DEFAULT_WORKSPACE_SETTINGS;

  async function change(event) {
    const projectCreation = event.target.value;
    const previous = settings;
    setSettings({ ...settings, projectCreation });
    setSaving(true);
    try {
      setSettings(await api.settings.update({ projectCreation }));
      toast.success(projectCreation === 'everyone' ? 'Everyone can now create projects.' : 'Only leads and admins can create projects now.');
    } catch (error) {
      setSettings(previous);
      toast.error(`Could not change the setting. ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workspace-settings" aria-labelledby="workspace-settings-title">
      <div>
        <h2 id="workspace-settings-title" className="workspace-settings-title">Organisation settings</h2>
        <p className="workspace-settings-hint">Applies to everyone at once. Existing projects keep their owners.</p>
      </div>
      <div className="workspace-setting">
        <label htmlFor="project-creation" className="workspace-setting-label">Who can create projects</label>
        <select id="project-creation" className="select" value={settings.projectCreation} onChange={change} disabled={saving || !loaded} aria-busy={saving || undefined}>
          {PROJECT_CREATION.map((value) => (
            <option key={value} value={value}>{PROJECT_CREATION_LABELS[value]}</option>
          ))}
        </select>
      </div>
    </section>
  );
}

/** Admin user management (SRS §2.2): find accounts, change organisation roles, deactivate accounts. */
export function UsersAdmin() {
  const me = useSession((s) => s.user);
  const settings = useWorkspace((s) => s.settings);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const isAdmin = me?.role === 'Admin';
  const users = useQuery(isAdmin ? `admin-users:${role}:${status}:${q}` : null, () => api.users.list({ q, role, status }));

  if (!isAdmin) {
    return (
      <EmptyState icon={ShieldCheck} title="Admins only">
        Ask an organisation admin if you need a different role.
      </EmptyState>
    );
  }

  const data = users.data;
  const items = data?.items || [];
  const hasMore = Boolean(data && items.length < data.total);

  // Apply a saved change to the list on screen. A search typed while the request was out can
  // replace that list with one still loading, so there may be nothing to patch: load the lists
  // again instead, so none of them keeps the old value.
  function patchUsers(update) {
    users.setData((current) => (current ? update(current) : current));
    invalidateQuery('admin-users:');
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const next = await api.users.list({ q, role, status, page: data.page + 1 });
      users.setData((current) => {
        if (!current) return current;
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
      patchUsers((current) => {
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

  async function setActive(user, active) {
    setConfirmingId(null);
    setSavingId(user.id);
    try {
      const updated = await api.users.setActive(user.id, active);
      patchUsers((current) => ({
        ...current,
        deactivatedCount: Math.max(0, (current.deactivatedCount ?? 0) + (active ? -1 : 1)),
        items: current.items.map((u) => (u.id === user.id ? { ...u, ...updated } : u)),
      }));
      toast.success(active ? `${user.name} can sign in again.` : `${user.name} was deactivated and signed out everywhere.`);
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
      <PageHeader title="Users" description="Everyone with an account. Role changes take effect on their next request; deactivating an account signs it out everywhere." />

      {counts ? (
        <dl className="role-summary" aria-label="Accounts by role">
          <div>
            <dt>All accounts</dt>
            <dd>{totalUsers}</dd>
            <dd className="role-summary-hint">{data.deactivatedCount ? `${data.deactivatedCount} deactivated` : 'All active'}</dd>
          </div>
          {ROLES.map((r) => (
            <div key={r}>
              <dt>{r}s</dt>
              <dd>{counts[r]}</dd>
              <dd className="role-summary-hint" title={WORKSPACE_ROLE_SUMMARY[r]}>{roleHint(r, settings ?? undefined)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <OrganisationSettings />

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
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Account status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
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
              <li key={user.id} className="user-row" data-inactive={user.active === false || undefined}>
                <Avatar user={user} />
                <span className="user-row-text">
                  <span className="user-row-name">
                    {user.name}
                    {self ? <span className="user-row-you"> · You</span> : null}
                    {user.active === false ? <span className="member-flag">Deactivated</span> : null}
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
                <span className="user-row-status">
                  {self ? null : confirmingId === user.id ? (
                    <span className="member-confirm" role="group" aria-label={`Confirm deactivating ${user.name}`}>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                      <Button variant="danger" size="sm" autoFocus onClick={() => setActive(user, false)}>
                        Deactivate
                      </Button>
                    </span>
                  ) : user.active === false ? (
                    <Button size="sm" variant="ghost" loading={savingId === user.id} onClick={() => setActive(user, true)}>
                      <RotateCcw size={14} /> Reactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" iconOnly aria-label={`Deactivate ${user.name}`} title="Deactivate account" loading={savingId === user.id} onClick={() => setConfirmingId(user.id)}>
                      <Ban size={15} />
                    </Button>
                  )}
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
