import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { Project, User } from '../models/index.js';
import { isAdmin } from '../services/access.js';
import { userDto } from '../utils/dto.js';
import { HttpError } from '../utils/http-error.js';
import { readListOptions } from '../utils/pagination.js';
import { escapeRegex, readEnum, readFilterString, readId, requireObject } from '../utils/validation.js';
import { updateCurrentUser } from './auth.js';

export const ROLES = ['Admin', 'Lead', 'Member'];
const STATUSES = ['active', 'deactivated'];
const ACTIVE_ADMIN = { role: 'Admin', deactivatedAt: null };

function requireAdmin(request) {
  if (!isAdmin(request.user)) throw new HttpError(403, 'FORBIDDEN', 'Only an admin can manage user accounts.');
}

async function projectCounts(userIds) {
  if (userIds.length === 0) return new Map();
  const rows = await Project.aggregate([
    { $match: { memberIds: { $in: userIds } } },
    { $unwind: '$memberIds' },
    { $match: { memberIds: { $in: userIds } } },
    { $group: { _id: '$memberIds', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export function createUsersRouter({ jwtSecret, jwtExpiresIn } = {}) {
  const router = Router();
  const requireAuth = authenticate({ jwtSecret });

  router.patch('/me', requireAuth, async (request, response) => {
    response.json(await updateCurrentUser(request.authUser, request.body, { jwtSecret, jwtExpiresIn }));
  });

  // SRS §2.2: the Admin manages user accounts and roles. Lists every account, newest first.
  router.get('/', requireAuth, async (request, response) => {
    requireAdmin(request);
    const { page, pageSize, skip } = readListOptions(request.query);
    const q = readFilterString(request.query, 'q', 100);
    const role = request.query.role === undefined || request.query.role === ''
      ? undefined
      : readEnum(request.query, 'role', ROLES, { label: 'Role' });
    const status = request.query.status === undefined || request.query.status === ''
      ? undefined
      : readEnum(request.query, 'status', STATUSES, { label: 'Status' });
    const filter = {};
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: pattern }, { email: pattern }];
    }
    if (role) filter.role = role;
    if (status) filter.deactivatedAt = status === 'active' ? null : { $ne: null };

    const [users, total, roleRows, deactivated] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: 1 }).skip(skip).limit(pageSize).lean(),
      User.countDocuments(filter),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.countDocuments({ deactivatedAt: { $ne: null } }),
    ]);
    const counts = await projectCounts(users.map((user) => String(user._id)));
    const roleCounts = Object.fromEntries(ROLES.map((name) => [name, roleRows.find((row) => row._id === name)?.count ?? 0]));
    response.json({
      items: users.map((user) => ({
        ...userDto({ ...user, id: String(user._id) }),
        projectCount: counts.get(String(user._id)) ?? 0,
      })),
      page,
      pageSize,
      total,
      roleCounts,
      deactivatedCount: deactivated,
    });
  });

  router.patch('/:userId/role', requireAuth, async (request, response) => {
    requireAdmin(request);
    const userId = readId(request.params.userId, 'User');
    const role = readEnum(requireObject(request.body), 'role', ROLES, { label: 'Role' });
    const target = await User.findById(userId);
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    const previous = target.role;
    if (previous === role) return response.json(userDto(target));

    const updated = await User.findOneAndUpdate(
      { _id: userId, role: previous },
      { $set: { role } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) throw new HttpError(409, 'CONFLICT', 'This user changed while you were editing. Reload and try again.');
    // Checked after the write so two admins demoting each other at once cannot both succeed.
    // Deactivated admins can't sign in, so only active ones count.
    if (previous === 'Admin' && await User.countDocuments(ACTIVE_ADMIN) === 0) {
      await User.updateOne({ _id: userId }, { $set: { role: 'Admin' } });
      throw new HttpError(409, 'LAST_ADMIN', 'The workspace needs at least one admin. Promote someone else first.');
    }
    // Added to the request logger's audit record for this Admin write (no secrets, only the roles).
    response.locals.auditChange = { field: 'role', from: previous, to: role };
    response.json(userDto(updated));
  });

  // Deactivate or reactivate an account. Deactivation signs the user out everywhere (token
  // version bump) and blocks sign-in; their projects, tasks and comments are kept.
  router.patch('/:userId/status', requireAuth, async (request, response) => {
    requireAdmin(request);
    const userId = readId(request.params.userId, 'User');
    const body = requireObject(request.body);
    if (typeof body.active !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Send active as true or false.', { active: 'Must be true or false.' });
    }
    if (userId === request.user.id && !body.active) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot deactivate your own account.');
    }
    const target = await User.findById(userId);
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    const wasActive = !target.deactivatedAt;
    if (wasActive === body.active) return response.json(userDto(target));
    const update = body.active
      ? { $set: { deactivatedAt: null } }
      : { $set: { deactivatedAt: new Date() }, $inc: { tokenVersion: 1 } };
    const updated = await User.findOneAndUpdate({ _id: userId }, update, { returnDocument: 'after' });
    if (!updated) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    // The acting admin is active and can't deactivate themselves, so an active admin always remains.
    response.locals.auditChange = { field: 'status', from: wasActive ? 'active' : 'deactivated', to: body.active ? 'active' : 'deactivated' };
    response.json(userDto(updated));
  });

  return router;
}
