import { createHash } from 'node:crypto';
import { Invitation, Organisation, User } from '../models/index.js';
import { invitationEmailMismatch, invitationProblem, invitationState, isInvitationTokenShape } from '../../src/lib/invitations.js';
import { HttpError } from '../utils/http-error.js';
import { normalizeEmail } from '../utils/validation.js';

export function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** What an Admin sees in the list. Never the token or its hash. */
export function invitationDto(invitation, now, names = new Map()) {
  const toIso = (value) => (value ? new Date(value).toISOString() : null);
  return {
    id: String(invitation._id),
    email: invitation.email,
    state: invitationState(invitation, now),
    createdAt: toIso(invitation.createdAt),
    expiresAt: toIso(invitation.expiresAt),
    acceptedAt: toIso(invitation.acceptedAt),
    revokedAt: toIso(invitation.revokedAt),
    createdBy: invitation.createdById ? { id: invitation.createdById, name: names.get(invitation.createdById) ?? null } : null,
  };
}

function problemError(problem) {
  return new HttpError(problem.status, problem.errorCode, problem.message, problem.fields);
}

/** The invitation behind a link, if it can still be used; otherwise the reason as an HttpError. */
export async function findUsableInvitation(token, now) {
  const invitation = isInvitationTokenShape(token)
    ? await Invitation.findOne({ tokenHash: hashInvitationToken(token) }).lean()
    : null;
  const problem = invitationProblem(invitation, now);
  if (problem) throw problemError(problem);
  return invitation;
}

/** For the register page: who the link is for and which organisation it joins. */
export async function describeInvitation(token, now) {
  const invitation = await findUsableInvitation(token, now);
  const organisation = await Organisation.findById(invitation.organisationId).select('name').lean();
  if (!organisation) throw problemError(invitationProblem(null, now));
  return {
    email: invitation.email,
    expiresAt: new Date(invitation.expiresAt).toISOString(),
    organisation: { id: String(organisation._id), name: organisation.name },
  };
}

/**
 * Claims a link for a registration: checks the address, then marks the invitation accepted in one
 * conditional write, so two registrations racing on the same link can't both get in.
 * @returns {Promise<{ invitation: object, organisation: { _id: string, name: string } }>}
 */
export async function claimInvitation(token, email, now) {
  const invitation = await findUsableInvitation(token, now);
  if (invitation.emailNormalized !== normalizeEmail(email)) throw problemError(invitationEmailMismatch(invitation.email));
  const organisation = await Organisation.findById(invitation.organisationId).select('_id name').lean();
  if (!organisation) throw problemError(invitationProblem(null, now));
  const claimed = await Invitation.findOneAndUpdate(
    { _id: invitation._id, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { acceptedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) throw problemError(invitationProblem({ ...invitation, acceptedAt: now }, now));
  return { invitation: claimed, organisation };
}

/** Registration finished: remember who joined. Registration failed: give the link back. */
export async function completeInvitation(invitationId, userId) {
  await Invitation.updateOne({ _id: invitationId }, { $set: { acceptedById: userId } });
}

export async function releaseInvitation(invitationId) {
  await Invitation.updateOne({ _id: invitationId, acceptedById: null }, { $set: { acceptedAt: null } });
}

export async function accountExists(email) {
  return Boolean(await User.exists({ emailNormalized: normalizeEmail(email) }));
}
