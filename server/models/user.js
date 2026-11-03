import mongoose from 'mongoose';
import { createSchema } from './schema.js';

const userSchema = createSchema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: { type: String, required: true, maxlength: 254 },
  emailNormalized: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['Admin', 'Lead', 'Member'], default: 'Member', required: true },
});

userSchema.index({ emailNormalized: 1 }, { unique: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
