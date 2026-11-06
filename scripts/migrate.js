// Applies data migrations (see server/utils/migrations.js). The API also runs them on startup;
// this script is for running them ahead of a deploy. Safe to run more than once.
import mongoose from 'mongoose';
import { loadEnvironment } from '../server/config/env.js';
import { runMigrations } from '../server/utils/migrations.js';

try {
  const { mongoUri } = loadEnvironment();
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  await runMigrations();
  console.info(JSON.stringify({ event: 'migrations_complete' }));
} catch (error) {
  console.error(JSON.stringify({ event: 'migration_failed', errorType: error?.name, variable: error?.variable }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
