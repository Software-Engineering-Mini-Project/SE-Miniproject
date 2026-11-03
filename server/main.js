import next from 'next';
import express from 'express';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadEnvironment } from './config/env.js';

export async function startMonolith({ dev = process.argv.includes('--dev'), config = loadEnvironment() } = {}) {
  const web = next({ dev, dir: process.cwd() });
  await web.prepare();
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const api = createApp({ jwtSecret: config.jwtSecret, jwtExpiresIn: config.jwtExpiresIn, corsOrigins: config.corsOrigins });
  const app = express();
  app.use((request, response, nextMiddleware) => request.path === '/api' || request.path.startsWith('/api/')
    ? api(request, response, nextMiddleware)
    : web.getRequestHandler()(request, response));
  return app.listen(config.port, () => console.info(`Task Manager listening on ${config.port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMonolith().catch((error) => { console.error(error?.variable ? `Invalid configuration: ${error.variable}` : 'Server startup failed.'); process.exitCode = 1; });
}
