/**
 * Personal invitation links (issue #78): an Admin invites one email address into the
 * organisation with a link that works once, for that address only, for seven days, unless the
 * Admin revokes it first. The organisation's invite code (src/lib/organisation.js) still works
 * alongside; a link is for when the code should not be shared.
 *
 * Shared by the API, the in-browser mock API and the UI. Runs in Node and in the browser.
 */

export const INVITATION_TTL_DAYS = 7;
export const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const INVITATION_TOKEN_LENGTH = 32;
export const INVITATION_LIST_LIMIT = 200;
export const INVITATION_STATES = ['pending', 'accepted', 'revoked', 'expired'];
export const INVITATION_STATE_LABELS = { pending: 'Waiting', accepted: 'Joined', revoked: 'Revoked', expired: 'Expired' };

// URL-safe base64 alphabet: 64 symbols, so a masked random byte is unbiased. 32 of them = 192 bits.
const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const TOKEN_RE = new RegExp(`^[A-Za-z0-9_-]{${INVITATION_TOKEN_LENGTH}}$`);

/** A fresh secret for one link. The API keeps only its hash; the link is shown once. */
export function generateInvitationToken() {
  const bytes = new Uint8Array(INVITATION_TOKEN_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => TOKEN_ALPHABET[byte & 63]).join('');
}

export function isInvitationTokenShape(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** The path the Admin shares; the register page reads `invite` from it. */
export function invitationPath(token) {
  return `/register?invite=${encodeURIComponent(token)}`;
}

export function invitationExpiry(now) {
  return new Date(new Date(now).getTime() + INVITATION_TTL_MS);
}

/** Where an invitation stands at `now`. Accepted and revoked are final; expiry is read from the clock. */
export function invitationState(invitation, now) {
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.revokedAt) return 'revoked';
  return new Date(invitation.expiresAt).getTime() <= new Date(now).getTime() ? 'expired' : 'pending';
}

const PROBLEMS = {
  missing: { status: 404, errorCode: 'INVITATION_NOT_FOUND', message: "This invitation link isn't valid. Check you copied all of it, or ask your admin for a new one." },
  accepted: { status: 410, errorCode: 'INVITATION_USED', message: 'This invitation has already been used. Sign in instead, or ask your admin for a new link.' },
  revoked: { status: 410, errorCode: 'INVITATION_REVOKED', message: 'This invitation was withdrawn. Ask your admin for a new link.' },
  expired: { status: 410, errorCode: 'INVITATION_EXPIRED', message: 'This invitation has expired. Ask your admin for a new link.' },
};

/** Why a link can't be used right now, or null when it can. `invitation` may be null (unknown link). */
export function invitationProblem(invitation, now) {
  if (!invitation) return PROBLEMS.missing;
  const state = invitationState(invitation, now);
  return state === 'pending' ? null : PROBLEMS[state];
}

export function invitationEmailMismatch(invitedEmail) {
  return {
    status: 400,
    errorCode: 'VALIDATION_ERROR',
    message: 'This invitation is for a different email address.',
    fields: { email: `This invitation is for ${invitedEmail}. Register with that address.` },
  };
}
