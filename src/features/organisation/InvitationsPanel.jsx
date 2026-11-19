'use client';

import { useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import { ApiError, describeError } from '@/lib/api/errors';
import { formatDate, formatRelative } from '@/lib/format';
import { useQuery } from '@/lib/hooks/useQuery';
import { INVITATION_STATE_LABELS, INVITATION_TTL_DAYS, invitationPath } from '@/lib/invitations';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function stateDetail(invitation) {
  switch (invitation.state) {
    case 'pending': return `Expires ${formatDate(invitation.expiresAt)}`;
    case 'accepted': return `Joined ${formatRelative(invitation.acceptedAt)}`;
    case 'revoked': return `Revoked ${formatRelative(invitation.revokedAt)}`;
    default: return `Expired ${formatDate(invitation.expiresAt)}`;
  }
}

/**
 * Personal invitation links (issue #78), Admins only: one link per email address, usable once,
 * for seven days. The link is shown once, when it is made, because the API keeps only its hash.
 */
export function InvitationsPanel({ userId }) {
  const list = useQuery(`organisation:invitations:${userId}`, () => api.organisation.invitations.list());
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(null);

  async function create(event) {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) return setError('Enter a valid email address.');
    setCreating(true);
    setError(null);
    try {
      const invitation = await api.organisation.invitations.create(address);
      setCreated({ ...invitation, url: `${window.location.origin}${invitationPath(invitation.token)}` });
      setCopied(false);
      setEmail('');
      list.reload();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.fields?.email ? failure.fields.email : describeError(failure));
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  }

  async function revoke(invitation) {
    setRevoking(invitation.id);
    try {
      await api.organisation.invitations.revoke(invitation.id);
      if (created?.id === invitation.id) setCreated(null);
      list.reload();
      toast.success(`The link for ${invitation.email} no longer works.`);
    } catch (failure) {
      toast.error(`Could not revoke the link. ${describeError(failure)}`);
    } finally {
      setRevoking(null);
    }
  }

  const invitations = list.data;
  return (
    <section className="org-card org-invitations" aria-labelledby="invitations-title">
      <h2 id="invitations-title" className="org-card-title">
        <Link2 size={16} aria-hidden="true" /> Invite by link
      </h2>
      <p className="org-card-hint">
        A personal link joins one person as a member without sharing the code. It works once, only for that email address, for {INVITATION_TTL_DAYS} days.
      </p>
      <form className="invitation-form" noValidate onSubmit={create}>
        <Field label="Email address" error={error}>
          <input className="input" type="email" inputMode="email" autoComplete="off" value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} />
        </Field>
        <Button type="submit" variant="primary" size="sm" loading={creating}>Create link</Button>
      </form>

      {created ? (
        <div className="invitation-created" role="status">
          <p>
            Link for <strong>{created.email}</strong>. Copy it now and send it to them yourself: for safety it is shown only once. It expires {formatDate(created.expiresAt)}.
          </p>
          <div className="invite-row">
            <input className="input invitation-link" readOnly value={created.url} aria-label={`Invitation link for ${created.email}`} onFocus={(event) => event.target.select()} />
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      ) : null}

      {list.error && !invitations ? (
        <ErrorState error={list.error} title="Invitations did not load" onRetry={list.reload} align="start" />
      ) : !invitations ? (
        <Skeleton height={44} radius="var(--radius)" />
      ) : invitations.length ? (
        <ul className="invitation-list" aria-label="Invitations">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="invitation-row">
              <div className="invitation-main">
                <span className="invitation-email">{invitation.email}</span>
                <span className="invitation-meta">
                  <span className="invitation-state" data-state={invitation.state}>{INVITATION_STATE_LABELS[invitation.state]}</span>
                  {stateDetail(invitation)}
                </span>
              </div>
              {invitation.state === 'pending' ? (
                <Button variant="ghost" size="sm" loading={revoking === invitation.id} disabled={Boolean(revoking)} onClick={() => revoke(invitation)} aria-label={`Revoke the link for ${invitation.email}`}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="org-card-hint">No links yet.</p>
      )}
    </section>
  );
}
