import mongoose from 'mongoose';
import express from 'express';
import { createApp } from './app.js';
import { ConfigurationError, loadEnvironment } from './config/env.js';

let config;
try {
  config = loadEnvironment();
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  console.error(JSON.stringify({ errorCode: 'CONFIGURATION_ERROR', variable: error.variable }));
}
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
  } catch {
    console.error(JSON.stringify({ errorCode: 'DATABASE_UNAVAILABLE' }));
    _response.status(503).json({ errorCode: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.' });
  }
}

// Vercel reuses warm function instances, so share one MongoDB connection
// across requests while still reconnecting after a failed initial connection.
const app = config ? createApp({
  jwtSecret: config.jwtSecret,
  jwtExpiresIn: config.jwtExpiresIn,
  corsOrigins: config.corsOrigins,
  beforeRoutes: [ensureDatabaseConnection],
}) : express().use((_request, response) => response.status(503).json({
  errorCode: 'CONFIGURATION_ERROR', message: 'Server is not configured.',
}));

export default app;
