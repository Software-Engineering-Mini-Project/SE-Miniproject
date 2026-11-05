import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { LoginAttempt, User } from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { userDto } from '../utils/dto.js';
import { HttpError } from '../utils/http-error.js';
import { BCRYPT_COST } from '../utils/password.js';
import { issueToken, TOKEN_TTL_SECONDS } from '../utils/token.js';
import {
  normalizeEmail,
  readEmail,
  readPassword,
  readString,
  requireObject,
} from '../utils/validation.js';

const FAILED_LOGIN_PAIR_LIMIT = 5;
const FAILED_LOGIN_IP_LIMIT = 60;
const FAILED_LOGIN_WINDOW_MS = 60_000;
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_MS = 10 * 60_000;
// Unknown emails are checked against this hash so the response time doesn't reveal which emails are registered.
const UNKNOWN_USER_HASH = '$2b$10$xWxI5wQNvlNQCxUJcnmUY.I5F3udThG6cKMGToEf0fRdYraRNZ5KO';

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

async function reserveRegistrationSlot(key, timestamp) {
  const expiresAt = new Date(timestamp.getTime() + REGISTRATION_WINDOW_MS);
  try {
    let bucket = await LoginAttempt.findOneAndUpdate(
      { _id: key, expiresAt: { $lte: timestamp } },
      { $set: { attempts: 1, windowStartedAt: timestamp, expiresAt } },
      { returnDocument: 'after', projection: { attempts: 1 } },
    ).lean();
    if (!bucket) {
      try {
        bucket = await LoginAttempt.findOneAndUpdate(
          { _id: key },
          { $inc: { attempts: 1 }, $setOnInsert: { windowStartedAt: timestamp, expiresAt } },
          { upsert: true, returnDocument: 'after', projection: { attempts: 1 } },
        ).lean();
      } catch (error) {
        if (error?.code !== 11000) throw error;
        bucket = await LoginAttempt.findOneAndUpdate(
          { _id: key }, { $inc: { attempts: 1 } }, { returnDocument: 'after', projection: { attempts: 1 } },
        ).lean();
      }
    }
    if (bucket.attempts > REGISTRATION_LIMIT) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many registration attempts. Wait ten minutes and try again.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'AUTH_RATE_LIMIT_UNAVAILABLE', 'Registration is temporarily unavailable. Try again.');
  }
}

export function createAuthRouter({ jwtSecret, jwtExpiresIn = TOKEN_TTL_SECONDS, now = () => new Date() }) {
  const router = Router();

  router.post('/register', async (request, response) => {
    // Validate first: a typo must not use up one of the five registrations per IP window.
    const body = requireObject(request.body);
    const name = readString(body, 'name', { max: 80, label: 'Name' });
    const email = readEmail(body);
    const password = readPassword(body);
    const ip = clientIp(request);
    const key = createHmac('sha256', jwtSecret).update(`register\0${ip}`).digest('hex');
    await reserveRegistrationSlot(key, now());
    // The unique index is the real guarantee (E11000 -> 409 in the error handler); this check also
    // keeps duplicates out if a deployment has not yet run `npm run db:indexes`.
    if (await User.exists({ emailNormalized: normalizeEmail(email) })) throw duplicateEmail();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await User.create({
      name,
      email,
      emailNormalized: normalizeEmail(email),
      passwordHash,
      role: 'Member',
    });
    response.status(201).json({ userId: user.id, email: user.email });
  });

  router.post('/login', (request, response, next) => {
    const start = performance.now();
    response.locals.loginTiming = { db: 0, bcrypt: 0 };
    const writeHead = response.writeHead;
    response.writeHead = function (...args) {
      const timing = response.locals.loginTiming;
      response.setHeader('Server-Timing', `db;dur=${timing.db.toFixed(1)}, bcrypt;dur=${timing.bcrypt.toFixed(1)}, total;dur=${(performance.now() - start).toFixed(1)}`);
      return writeHead.apply(this, args);
    };
    next();
  }, async (request, response) => {
    const body = requireObject(request.body);
    const email = readEmail(body);
    const password = readString(body, 'password', { min: 1, max: 128, trim: false, label: 'Password' });
    const normalizedEmail = normalizeEmail(email);
    const timestamp = now();
    const keys = limiterKeys(normalizedEmail, clientIp(request), jwtSecret);
    const dbStart = performance.now();
    let user;
    try {
      [, user] = await Promise.all([
        checkLoginLimit(keys, timestamp),
        User.findOne({ emailNormalized: normalizedEmail }).select('+passwordHash'),
      ]);
    } finally {
      response.locals.loginTiming.db = performance.now() - dbStart;
    }
    const bcryptStart = performance.now();
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? UNKNOWN_USER_HASH) && Boolean(user);
    response.locals.loginTiming.bcrypt = performance.now() - bcryptStart;
    if (!user || !passwordMatches) {
      await Promise.all([
        recordFailedLogin(keys.pair, timestamp),
        recordFailedLogin(keys.ip, timestamp),
      ]);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    if (bcrypt.getRounds(user.passwordHash) > BCRYPT_COST) {
      const oldHash = user.passwordHash;
      try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
        await User.updateOne({ _id: user._id, passwordHash: oldHash }, { $set: { passwordHash } });
      } catch {
        console.error(JSON.stringify({ event: 'password_rehash_failed' }));
      }
    }

    const { token, expiresIn } = issueToken(user, { jwtSecret, jwtExpiresIn });
    response.json({ token, expiresIn, user: userDto(user) });
  });

  router.get('/me', authenticate({ jwtSecret }), (request, response) => response.json(userDto(request.authUser)));

  return router;
}

function duplicateEmail() {
  return new HttpError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists.', {
    email: 'This email is already registered.',
  });
}

/**
 * Applies a name and/or password change. A password change revokes every existing session
 * (tokenVersion + 1) and returns a fresh `token`/`expiresIn` alongside the user fields.
 */
export async function updateCurrentUser(user, rawBody, { jwtSecret, jwtExpiresIn = TOKEN_TTL_SECONDS } = {}) {
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
    changes.passwordHash = await bcrypt.hash(next, BCRYPT_COST);
  }

  if (Object.keys(changes).length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Provide a name or password change.');
  }
  const passwordChanged = Boolean(changes.passwordHash);
  const updated = await User.findByIdAndUpdate(
    user.id,
    { $set: changes, ...(passwordChanged ? { $inc: { tokenVersion: 1 } } : {}) },
    { returnDocument: 'after', runValidators: true },
  );
  if (!updated) throw new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.');
  if (!passwordChanged) return userDto(updated);
  return { ...userDto(updated), ...issueToken(updated, { jwtSecret, jwtExpiresIn }) };
}
