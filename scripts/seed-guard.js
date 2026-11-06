// Refuses to wipe a database that looks shared or production unless the operator says so.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'mongo', 'mongodb']);

/**
 * @param {string} mongoUri
 * @param {{ nodeEnv?: string, allow?: boolean }} options
 * @returns {string | null} why seeding is refused, or null when it may proceed
 */
export function seedRefusalReason(mongoUri, { nodeEnv, allow = false } = {}) {
  if (allow) return null;
  if (nodeEnv === 'production') return 'NODE_ENV is production';
  if (mongoUri.startsWith('mongodb+srv://')) return 'the URI is a mongodb+srv (hosted) cluster';
  const hosts = mongoUri.replace(/^mongodb:\/\//, '').split('/')[0].split('@').pop().split(',')
    .map((host) => host.replace(/:\d+$/, '').toLowerCase());
  const remote = hosts.find((host) => !LOCAL_HOSTS.has(host));
  return remote ? `the database host "${remote}" is not local` : null;
}
