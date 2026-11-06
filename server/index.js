import mongoose from 'mongoose';
import express from 'express';
import { createApp } from './app.js';
import { ConfigurationError, loadEnvironment } from './config/env.js';
import { runMigrations } from './utils/migrations.js';

let config;
try {
  config = loadEnvironment();
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  console.error(JSON.stringify({ errorCode: 'CONFIGURATION_ERROR', variable: error.variable }));
}
const cache = globalThis.__mongooseConn ??= { promise: null };

function connectDatabase() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!cache.promise) {
    const pending = mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 5,
      autoIndex: process.env.NODE_ENV !== 'production',
    }).then(async (connection) => {
      // Once per process, before the first request is served. A failed migration is logged
      // and retried on the next cold start instead of taking the API down.
      if (!cache.migrated) {
        try {
          await runMigrations();
          cache.migrated = true;
        } catch (error) {
          console.error(JSON.stringify({ event: 'migration_failed', errorType: error?.name }));
        }
      }
      if (cache.promise === pending) cache.promise = null;
      return connection;
    }).catch((error) => {
      if (cache.promise === pending) cache.promise = null;
      throw error;
    });
    cache.promise = pending;
    // The first request will report a failed connection; avoid an unhandled rejection meanwhile.
    pending.catch(() => {});
  }
  return cache.promise;
}

if (config) connectDatabase();

async function ensureDatabaseConnection(_request, _response, next) {
  if (mongoose.connection.readyState === 1) {
    next();
    return;
  }

  try {
    await connectDatabase();
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
