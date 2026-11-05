// Replaces every collection with the synthetic fixtures. DESTRUCTIVE: local/test/demo databases only.
//   npm run seed                      fixture dates exactly as written (what the E2E suite expects)
//   npm run seed:demo                 dates moved so the demo has overdue, due-soon and later work today
//   ... -- --allow-remote-database    required for a non-local host or NODE_ENV=production
import mongoose from 'mongoose';
import { loadEnvironment } from '../server/config/env.js';
import { daysSinceFixtureAnchor, seedDatabase } from '../server/utils/seed-database.js';
import { seedRefusalReason } from './seed-guard.js';

const args = new Set(process.argv.slice(2));

try {
  const environment = loadEnvironment();
  const refusal = seedRefusalReason(environment.mongoUri, {
    nodeEnv: process.env.NODE_ENV,
    allow: args.has('--allow-remote-database'),
  });
  if (refusal) {
    console.error(JSON.stringify({ event: 'database_seed_refused', reason: `${refusal}; pass --allow-remote-database to wipe it anyway` }));
    process.exitCode = 1;
  } else {
    await mongoose.connect(environment.mongoUri, { serverSelectionTimeoutMS: 5000 });
    const shiftDays = args.has('--demo-dates') ? daysSinceFixtureAnchor(new Date().toISOString().slice(0, 10)) : 0;
    const counts = await seedDatabase({ shiftDays });
    console.info(JSON.stringify({ event: 'database_seeded', counts, shiftDays }));
  }
} catch (error) {
  console.error(JSON.stringify({
    event: 'database_seed_failed',
    configurationVariable: error?.variable,
    errorType: error?.name,
  }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
