import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { HttpError } from './utils/http-error.js';

const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE'];
const allowedHeaders = ['Authorization', 'Content-Type'];

function getAllowedOrigins() {
  return (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function registerRoutes(app) {
  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
}

/** Create an importable Express app. Database connection belongs to server.js. */
export function createApp({ logger = console, now = () => new Date(), extendRoutes } = {}) {
  const app = express();
  app.disable('x-powered-by');
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

  registerRoutes(app);
  extendRoutes?.(app);

  app.use((_request, _response, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'Route not found.'));
  });
  app.use(errorHandler({ now }));
  return app;
}

const app = createApp();

export default app;
