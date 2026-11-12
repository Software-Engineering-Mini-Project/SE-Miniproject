import mongoose from 'mongoose';
import { createSchema } from './schema.js';

/**
 * A personal invitation link into an organisation (issue #78). Only a SHA-256 hash of the link's
 * secret is stored, so a database leak doesn't hand out working links; the Admin sees the link
 * once, when it is created. Accepted and revoked invitations are kept as a record.
 */
const invitationSchema = createSchema({
  organisationId: { type: String, ref: 'Organisation', required: true },
  email: { type: String, required: true, trim: true, maxlength: 254 },
  emailNormalized: { type: String, required: true },
  tokenHash: { type: String, required: true, select: false },
  createdById: { type: String, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date, default: null },
  acceptedById: { type: String, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },
});

invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ organisationId: 1, createdAt: -1 });
invitationSchema.index({ organisationId: 1, emailNormalized: 1 });

export const Invitation = mongoose.models.Invitation || mongoose.model('Invitation', invitationSchema);
