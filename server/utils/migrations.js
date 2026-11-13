import mongoose from 'mongoose';
import { Organisation, Project, Task, User } from '../models/index.js';
import { uniqueJoinCode } from '../services/organisation.js';
import { isDuplicateKeyError, takenProjectKeys } from '../services/work-items.js';
import { suggestProjectKey } from '../../src/lib/work-items.js';

export const DEFAULT_ORGANISATION_ID = 'org-default';

/**
 * Per-project roles (managerIds/viewerIds) replaced the old rule that any workspace Lead in a
 * project could manage it. Projects created before that have no managerIds field; give each
 * one the role arrays and make its non-owner Lead members Managers, so nobody loses access.
 *
 * Only touches projects without managerIds, so it runs once per project and never re-promotes
 * someone an owner later demoted. Returns the number of projects migrated.
 */
export async function migrateProjectRoles() {
  if (!await Project.exists({ managerIds: { $exists: false } })) return 0;
  const leads = await User.find({ role: 'Lead' }).select('_id').lean();
  const leadIds = leads.map((user) => String(user._id));
  const result = await Project.updateMany({ managerIds: { $exists: false } }, [{
    $set: {
      managerIds: {
        $filter: {
          input: '$memberIds',
          cond: { $and: [{ $in: ['$$this', leadIds] }, { $ne: ['$$this', '$ownerId'] }] },
        },
      },
      viewerIds: { $ifNull: ['$viewerIds', []] },
    },
  }], { updatePipeline: true });
  return result.modifiedCount;
}

/**
 * Tasks completed before completedAt existed: use their last update as the completion time,
 * the closest record there is. Only touches Done tasks without the field.
 */
export async function migrateCompletedAt() {
  const result = await Task.updateMany(
    { status: 'Done', completedAt: { $exists: false } },
    [{ $set: { completedAt: '$updatedAt' } }],
    { updatePipeline: true, timestamps: false },
  );
  return result.modifiedCount;
}

/**
 * Before organisations, every account and project lived in one shared workspace. Put whatever has
 * no organisation into a single "My organisation" (_id `org-default`) so nobody loses anything;
 * an Admin can rename it and rotate its invite code on the Organisation page. The old global
 * workspace setting (`settings` collection) becomes this organisation's setting.
 *
 * Idempotent: it only acts while something still lacks an organisation, and creating the
 * organisation is an upsert, so two instances starting together agree on one. Returns the number
 * of accounts and projects moved.
 */
export async function migrateOrganisations() {
  const orphan = { $or: [{ organisationId: { $exists: false } }, { organisationId: null }] };
  if (!await User.exists(orphan) && !await Project.exists(orphan)) return 0;
  const legacy = await mongoose.connection.db.collection('settings').findOne({ _id: 'workspace' });
  await Organisation.updateOne(
    { _id: DEFAULT_ORGANISATION_ID },
    { $setOnInsert: {
      name: 'My organisation',
      joinCode: await uniqueJoinCode(),
      createdById: null,
      projectCreation: legacy?.projectCreation === 'leads' ? 'leads' : 'everyone',
    } },
    { upsert: true },
  );
  const users = await User.updateMany(orphan, { $set: { organisationId: DEFAULT_ORGANISATION_ID } }, { timestamps: false });
  const projects = await Project.updateMany(orphan, { $set: { organisationId: DEFAULT_ORGANISATION_ID } }, { timestamps: false });
  return users.modifiedCount + projects.modifiedCount;
}

/**
 * Work-item keys: give every project without a key one suggested from its name (unique in its
 * organisation), and every task without a number the next numbers in its project, oldest first.
 *
 * Numbers are reserved with an atomic $inc on the project's counter before they are written, so a
 * task created while this runs can never get the same number. Idempotent: it only touches projects
 * without a key and tasks without a number. Returns the number of projects and tasks updated.
 */
export async function migrateWorkItemKeys() {
  let updated = 0;
  const keyless = await Project.find({ $or: [{ key: { $exists: false } }, { key: null }] }).select('_id name organisationId').sort({ createdAt: 1, _id: 1 }).lean();
  for (const project of keyless) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const taken = await takenProjectKeys(project.organisationId, project._id);
      try {
        const result = await Project.updateOne(
          { _id: project._id, $or: [{ key: { $exists: false } }, { key: null }] },
          { $set: { key: suggestProjectKey(project.name, taken) } },
          { timestamps: false },
        );
        updated += result.modifiedCount;
        break;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
  }

  const projectIds = await Task.distinct('projectId', { number: { $exists: false } });
  for (const projectId of projectIds) {
    const tasks = await Task.find({ projectId, number: { $exists: false } }).select('_id').sort({ createdAt: 1, _id: 1 }).lean();
    if (tasks.length === 0) continue;
    const before = await Project.findOneAndUpdate(
      { _id: projectId },
      { $inc: { taskCounter: tasks.length } },
      { returnDocument: 'before', projection: { taskCounter: 1 }, timestamps: false },
    ).lean();
    if (!before) continue; // tasks of a deleted project
    const start = before.taskCounter ?? 0;
    const result = await Task.bulkWrite(tasks.map((task, index) => ({
      updateOne: { filter: { _id: task._id, number: { $exists: false } }, update: { $set: { number: start + index + 1 } }, timestamps: false },
    })));
    updated += result.modifiedCount;
  }
  return updated;
}

/** Runs every data migration; each is idempotent and cheap when there is nothing to do. */
export async function runMigrations({ logger = console } = {}) {
  const moved = await migrateOrganisations();
  if (moved > 0) logger.info?.(JSON.stringify({ event: 'migration_applied', name: 'organisations', records: moved }));
  const keyed = await migrateWorkItemKeys();
  if (keyed > 0) logger.info?.(JSON.stringify({ event: 'migration_applied', name: 'work_item_keys', records: keyed }));
  const projects = await migrateProjectRoles();
  if (projects > 0) logger.info?.(JSON.stringify({ event: 'migration_applied', name: 'project_roles', projects }));
  const tasks = await migrateCompletedAt();
  if (tasks > 0) logger.info?.(JSON.stringify({ event: 'migration_applied', name: 'task_completed_at', tasks }));
}
