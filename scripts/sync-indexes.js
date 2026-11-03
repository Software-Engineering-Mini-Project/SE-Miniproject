import mongoose from 'mongoose';
import { loadEnvironment } from '../server/config/env.js';
import { models } from '../server/models/index.js';

try {
  const { mongoUri } = loadEnvironment();
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  for (const model of models) {
    // This reconciles the dashboard task aggregate and unread-notification indexes in each target database.
    const changes = await model.syncIndexes();
    console.info(JSON.stringify({ event: 'indexes_synchronized', model: model.modelName, changes }));
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'index_sync_failed', errorType: error?.name, variable: error?.variable }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
