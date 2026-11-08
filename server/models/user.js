import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const userSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: { type: String, required: true, maxlength: 254 },
  emailNormalized: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  lastReminderScanAt: { type: Date, default: null },
  // Bumped on password change; tokens carry the value they were issued with (claim `tv`),
  // so every session issued before the change stops working.
  tokenVersion: { type: Number, default: 0, min: 0 },
  // The organisation this account belongs to; every query that reaches across accounts is scoped by it.
  organisationId: { type: String, ref: 'Organisation', required: true },
  role: { type: String, enum: ['Admin', 'Lead', 'Member'], default: 'Member', required: true },
  // Set by an Admin to block sign-in without deleting the account (its tasks and comments stay).
  deactivatedAt: { type: Date, default: null },
});

userSchema.index({ emailNormalized: 1 }, { unique: true });
userSchema.index({ organisationId: 1, role: 1 });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
