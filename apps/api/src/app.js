import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { createApiRouter } from './routes/index.js';
import { HttpError } from './utils/http-error.js';

const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE'];
const allowedHeaders = ['Authorization', 'Content-Type'];
let vercelMongoConnection;

function getAllowedOrigins() {
  return (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function ensureVercelDatabase(_request, _response, next) {
  if (process.env.VERCEL !== '1') {
    next();
    return;
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      if (!vercelMongoConnection || mongoose.connection.readyState === 0) {
        const mongoUri = process.env.MONGODB_URI?.trim();
        if (!mongoUri) throw new Error('MONGODB_URI is required');

        vercelMongoConnection = mongoose.connect(mongoUri, {
          serverSelectionTimeoutMS: 5000,
        }).catch((error) => {
          vercelMongoConnection = undefined;
          throw error;
        });
      }
      await vercelMongoConnection;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function registerRoutes(app) {
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
}

/** Create an importable Express app. Database connection belongs to server.js outside Vercel. */
export function createApp({
  logger = console,
  now = () => new Date(),
  extendRoutes,
  jwtSecret = process.env.JWT_SECRET,
  jwtExpiresIn = Number(process.env.JWT_EXPIRES_IN) || 7200,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Trust only the private/loopback proxy ranges used by the hosting edge. A
  // direct public client is therefore identified by its socket address, not
  // by a caller-supplied X-Forwarded-For value.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || getAllowedOrigins().includes(origin));
    },
    methods: allowedMethods,
    allowedHeaders,
  }));
  app.use(requestLogger({ logger, now }));
  app.use(express.json({ limit: '100kb' }));

  // Vercel invokes the app without running server.js, so connect lazily and
  // reuse Mongoose's connection across warm function invocations.
  app.use(ensureVercelDatabase);

  registerRoutes(app);
  app.use('/api', createApiRouter({ jwtSecret, jwtExpiresIn, now }));
  extendRoutes?.(app);

  app.use((_request, _response, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'Route not found.'));
  });
  app.use(errorHandler({ now }));
  return app;
}

const app = createApp();

export default app;
