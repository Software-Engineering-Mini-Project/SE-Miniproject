// Personal invitation links (issue #78): the Admin's panel on the organisation page, and the
// register page opened from a link.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    router: { push: fn(), replace: fn() },
    queries: new Map(),
    session: { signIn: fn() },
    api: {
      auth: { register: fn(), invitation: fn() },
      organisation: { invitations: { list: fn(), create: fn(), revoke: fn() } },
    },
    toast: { success: fn(), error: fn() },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ href, children, ...props }) => createElement('a', { href, ...props }, children) };
});
vi.mock('@/lib/api/client', () => ({ api: state.api, apiConfig: { mode: 'http' } }));
vi.mock('@/lib/session', () => ({ useSession: (selector) => (selector ? selector(state.session) : state.session) }));
vi.mock('@/lib/hooks/useQuery', () => ({
  useQuery: (key) => state.queries.get(key) || { data: undefined, error: null, loading: Boolean(key), setData: vi.fn(), reload: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: state.toast }));

const { InvitationsPanel } = await import('../../src/features/organisation/InvitationsPanel.jsx');
const { RegisterForm } = await import('../../src/features/auth/RegisterForm.jsx');
const { ApiError } = await import('../../src/lib/api/errors.js');
const h = React.createElement;

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const reload = vi.fn();
const listed = (data) => state.queries.set('organisation:invitations:u1', { data, error: null, loading: false, reload, setData: vi.fn() });

beforeEach(() => {
  state.queries.clear();
  vi.clearAllMocks();
});

describe('the invitation links panel', () => {
  it('creates a link, shows it once with a copy button, and lists every invitation with its state', async () => {
    const user = userEvent.setup();
    listed([
      { id: 'i2', email: 'waiting@example.test', state: 'pending', expiresAt: '2026-11-19T10:00:00Z' },
      { id: 'i1', email: 'joined@example.test', state: 'accepted', acceptedAt: '2026-11-10T10:00:00Z' },
      { id: 'i0', email: 'old@example.test', state: 'expired', expiresAt: '2026-11-01T10:00:00Z' },
    ]);
    state.api.organisation.invitations.create.mockResolvedValue({ id: 'i3', email: 'new@example.test', state: 'pending', expiresAt: '2026-11-19T10:00:00Z', token: TOKEN, path: `/register?invite=${TOKEN}` });
    render(h(InvitationsPanel, { userId: 'u1' }));

    const rows = within(screen.getByRole('list', { name: 'Invitations' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.invitation-state').textContent)).toEqual(['Waiting', 'Joined', 'Expired']);
    expect(within(rows[0]).getByRole('button', { name: 'Revoke the link for waiting@example.test' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button')).toBeNull();

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(state.api.organisation.invitations.create).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Email address'));
    await user.type(screen.getByLabelText('Email address'), 'new@example.test');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(state.api.organisation.invitations.create).toHaveBeenCalledWith('new@example.test');
    const link = await screen.findByRole('textbox', { name: 'Invitation link for new@example.test' });
    expect(link).toHaveValue(`${window.location.origin}/register?invite=${TOKEN}`);
    expect(screen.getByRole('status')).toHaveTextContent('shown only once');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
  });

  it('revokes a waiting link and shows why a link could not be made', async () => {
    const user = userEvent.setup();
    listed([{ id: 'i2', email: 'waiting@example.test', state: 'pending', expiresAt: '2026-11-19T10:00:00Z' }]);
    state.api.organisation.invitations.revoke.mockResolvedValue({ id: 'i2', state: 'revoked' });
    state.api.organisation.invitations.create.mockRejectedValue(new ApiError(409, { errorCode: 'DUPLICATE_EMAIL', message: 'Taken.', fields: { email: 'There is already an account with this email.' } }));
    render(h(InvitationsPanel, { userId: 'u1' }));

    await user.click(screen.getByRole('button', { name: 'Revoke the link for waiting@example.test' }));
    expect(state.api.organisation.invitations.revoke).toHaveBeenCalledWith('i2');
    await waitFor(() => expect(state.toast.success).toHaveBeenCalledWith('The link for waiting@example.test no longer works.'));

    await user.type(screen.getByLabelText('Email address'), 'member@example.test');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText('There is already an account with this email.')).toBeInTheDocument();
  });
});

describe('registering from an invitation link', () => {
  it('names the organisation, fixes the email, and registers with the link instead of a code', async () => {
    const user = userEvent.setup();
    state.queries.set(`invitation:${TOKEN}`, { data: { email: 'new@example.test', expiresAt: '2026-11-19T10:00:00Z', organisation: { id: 'org-acme', name: 'Acme Labs' } }, error: null, loading: false, reload: vi.fn() });
    state.api.auth.register.mockResolvedValue({ userId: 'u9', role: 'Member' });
    render(h(RegisterForm, { inviteToken: TOKEN }));

    expect(screen.getByRole('heading', { name: 'Join Acme Labs' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText('Invite code')).toBeNull();
    const email = screen.getByLabelText('Email');
    expect(email).toHaveValue('new@example.test');
    expect(email).toHaveAttribute('readonly');

    await user.type(screen.getByLabelText('Full name'), 'New Person');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(state.api.auth.register).toHaveBeenCalledWith({ name: 'New Person', email: 'new@example.test', password: 'Password123!', inviteToken: TOKEN }));
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/dashboard'));
    expect(state.toast.success).toHaveBeenCalledWith('Account created. Welcome to Acme Labs.');
  });

  it('explains a link that can no longer be used, with a way forward', () => {
    state.queries.set(`invitation:${TOKEN}`, { data: undefined, error: new ApiError(410, { errorCode: 'INVITATION_EXPIRED', message: 'This invitation has expired. Ask your admin for a new link.' }), loading: false, reload: vi.fn() });
    render(h(RegisterForm, { inviteToken: TOKEN }));
    expect(screen.getByRole('heading', { name: "This invitation can't be used" })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This invitation has expired.');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  });
});
