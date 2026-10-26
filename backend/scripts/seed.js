import mongoose from 'mongoose';
import { loadEnvironment } from '../src/config/env.js';
import { seedDatabase } from '../src/utils/seed-database.js';

try {
  const environment = loadEnvironment();
  await mongoose.connect(environment.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const counts = await seedDatabase();
  console.info(JSON.stringify({ event: 'database_seeded', counts }));
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
