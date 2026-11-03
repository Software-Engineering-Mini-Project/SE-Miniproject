import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const loginAttemptSchema = createSchema({
  attempts: { type: Number, required: true, min: 1 },
  windowStartedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});

loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt = mongoose.models.LoginAttempt || mongoose.model('LoginAttempt', loginAttemptSchema);
