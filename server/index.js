import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';

const config = loadEnvironment();
let connectionPromise;

async function ensureDatabaseConnection(_request, _response, next) {
  if (mongoose.connection.readyState === 1) {
    next();
    return;
  }

  try {
    connectionPromise ??= mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    }).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
    await connectionPromise;
    next();
  } catch (error) {
    next(error);
  }
}

// Vercel reuses warm function instances, so share one MongoDB connection
// across requests while still reconnecting after a failed initial connection.
const app = createApp({
  jwtSecret: config.jwtSecret,
  jwtExpiresIn: config.jwtExpiresIn,
  corsOrigins: config.corsOrigins,
  beforeRoutes: [ensureDatabaseConnection],
});

export default app;
