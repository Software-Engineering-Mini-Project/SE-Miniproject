import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { LoginAttempt, User } from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { userDto } from '../utils/dto.js';
import { HttpError } from '../utils/http-error.js';
import {
  normalizeEmail,
  readEmail,
  readPassword,
  readString,
  requireObject,
} from '../utils/validation.js';

const TOKEN_TTL_SECONDS = 7200;
const FAILED_LOGIN_PAIR_LIMIT = 5;
const FAILED_LOGIN_IP_LIMIT = 60;
const FAILED_LOGIN_WINDOW_MS = 60_000;
// Unknown emails are checked against this hash so the response time doesn't reveal which emails are registered.
const UNKNOWN_USER_HASH = bcrypt.hashSync('unknown-user-timing-equalizer', 12);

function clientIp(request) {
  // Express derives `ip` from X-Forwarded-For only when the socket peer is in
  // the explicitly trusted proxy ranges configured in createApp().
  return request.ip || request.socket?.remoteAddress || 'unknown';
}

function limiterKeys(email, ip, secret) {
  const digest = (value) => createHmac('sha256', secret).update(value).digest('hex');
  return {
    pair: digest(`pair\0${email}\0${ip}`),
    ip: digest(`ip\0${ip}`),
  };
}

async function checkLoginLimit(keys, timestamp) {
  try {
    const attempts = await LoginAttempt.find({
      _id: { $in: [keys.pair, keys.ip] },
      expiresAt: { $gt: timestamp },
    }).select('_id attempts').lean();
    const counts = new Map(attempts.map((attempt) => [attempt._id, attempt.attempts]));
    if ((counts.get(keys.pair) ?? 0) >= FAILED_LOGIN_PAIR_LIMIT
      || (counts.get(keys.ip) ?? 0) >= FAILED_LOGIN_IP_LIMIT) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many failed login attempts. Wait a minute and try again.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 'Sign-in is temporarily unavailable. Try again.');
  }
}

async function recordFailedLogin(key, timestamp) {
  const expiresAt = new Date(timestamp.getTime() + FAILED_LOGIN_WINDOW_MS);
  try {
    const reset = await LoginAttempt.updateOne(
      { _id: key, expiresAt: { $lte: timestamp } },
      { $set: { attempts: 1, windowStartedAt: timestamp, expiresAt } },
    );
    if (reset.matchedCount > 0) return;

    try {
      await LoginAttempt.updateOne(
        { _id: key },
        { $inc: { attempts: 1 }, $setOnInsert: { windowStartedAt: timestamp, expiresAt } },
        { upsert: true },
      );
    } catch (error) {
      // Another replica may insert the same bucket between the upsert check and write.
      if (error?.code !== 11000) throw error;
      await LoginAttempt.updateOne({ _id: key }, { $inc: { attempts: 1 } });
    }
  } catch {
    throw new HttpError(503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 'Sign-in is temporarily unavailable. Try again.');
  }
}

export function createAuthRouter({ jwtSecret, jwtExpiresIn = TOKEN_TTL_SECONDS, now = () => new Date() }) {
  const router = Router();

  router.post('/register', async (request, response) => {
    const body = requireObject(request.body);
    const name = readString(body, 'name', { max: 80, label: 'Name' });
    const email = readEmail(body);
    const password = readPassword(body);
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      emailNormalized: normalizeEmail(email),
      passwordHash,
      role: 'Member',
    });
    response.status(201).json({ userId: user.id, email: user.email });
  });

  router.post('/login', async (request, response) => {
    const body = requireObject(request.body);
    const email = readEmail(body);
    const password = readString(body, 'password', { min: 1, max: 128, trim: false, label: 'Password' });
    const normalizedEmail = normalizeEmail(email);
    const timestamp = now();
    const keys = limiterKeys(normalizedEmail, clientIp(request), jwtSecret);
    await checkLoginLimit(keys, timestamp);

    const user = await User.findOne({ emailNormalized: normalizedEmail }).select('+passwordHash');
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? UNKNOWN_USER_HASH) && Boolean(user);
    if (!user || !passwordMatches) {
      await Promise.all([
        recordFailedLogin(keys.pair, timestamp),
        recordFailedLogin(keys.ip, timestamp),
      ]);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const token = jwt.sign({}, jwtSecret, {
      subject: user.id,
      expiresIn: jwtExpiresIn,
      algorithm: 'HS256',
    });
    response.json({ token, expiresIn: jwtExpiresIn });
  });

  router.get('/me', authenticate({ jwtSecret }), (request, response) => response.json(userDto(request.authUser)));

  return router;
}

export async function updateCurrentUser(user, rawBody) {
  const body = requireObject(rawBody);
  const changes = {};

  if (body.name !== undefined) changes.name = readString(body, 'name', { max: 80, label: 'Name' });

  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;
  if (currentPassword !== undefined || newPassword !== undefined) {
    if (currentPassword === undefined || newPassword === undefined) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Current and new passwords are required.', {
        currentPassword: 'Enter your current password.',
        newPassword: 'Enter a new password.',
      });
    }
    const current = readString(body, 'currentPassword', { min: 1, max: 128, trim: false, label: 'Current password' });
    const next = readPassword(body, 'newPassword');
    const userWithHash = await User.findById(user.id).select('+passwordHash');
    const matches = userWithHash && await bcrypt.compare(current, userWithHash.passwordHash);
    if (!matches) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Current password is incorrect.', {
        currentPassword: 'Current password is incorrect.',
      });
    }
    changes.passwordHash = await bcrypt.hash(next, 12);
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a name or password change.');
  }
  const updated = await User.findByIdAndUpdate(user.id, { $set: changes }, { returnDocument: 'after', runValidators: true });
  return userDto(updated);
}
