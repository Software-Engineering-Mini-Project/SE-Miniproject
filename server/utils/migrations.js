import { Project, User } from '../models/index.js';

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

/** Runs every data migration; each is idempotent and cheap when there is nothing to do. */
export async function runMigrations({ logger = console } = {}) {
  const projects = await migrateProjectRoles();
  if (projects > 0) logger.info?.(JSON.stringify({ event: 'migration_applied', name: 'project_roles', projects }));
}
