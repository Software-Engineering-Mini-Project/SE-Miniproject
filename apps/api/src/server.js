import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import app from './app.js';
import { loadEnvironment } from './config/env.js';

export async function startServer({
  environment,
  connect = mongoose.connect.bind(mongoose),
  listen = app.listen.bind(app),
  logger = console,
} = {}) {
  const config = environment ?? loadEnvironment();
  try {
    await connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  } catch {
    logger.error?.(JSON.stringify({ event: 'database_connection_failed' }));
    return null;
  }

  const server = listen(config.port, () => {
    logger.info?.(JSON.stringify({ event: 'api_listening', port: config.port }));
  });
  return server;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer().then((server) => {
    if (!server) process.exitCode = 1;
  }).catch((error) => {
    const variable = error?.variable;
    console.error(JSON.stringify({
      event: 'server_start_failed',
      configurationVariable: variable,
    }));
    process.exitCode = 1;
  });
}
