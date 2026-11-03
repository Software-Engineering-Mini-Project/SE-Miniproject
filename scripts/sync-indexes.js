import mongoose from 'mongoose';
import { loadEnvironment } from '../server/config/env.js';
import { models } from '../server/models/index.js';

try {
  const { mongoUri } = loadEnvironment();
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  for (const model of models) {
    await model.syncIndexes();
    console.info(`Indexes synchronized: ${model.modelName}`);
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'index_sync_failed', errorType: error?.name, variable: error?.variable }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
