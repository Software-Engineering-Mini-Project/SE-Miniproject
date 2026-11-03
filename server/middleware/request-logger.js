import { randomUUID } from 'node:crypto';

const writeLog = (logger, record) => {
  if (typeof logger === 'function') logger(record);
  else logger.info?.(record);
};

function requestIdFrom(request) {
  const suppliedId = request.get('x-request-id');
  return suppliedId && /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedId) ? suppliedId : randomUUID();
}

function routePattern(request) {
  if (!request.route) return request.path;
  return `${request.baseUrl}${request.route.path}`;
}

function targetIds(request) {
  return Object.fromEntries(
    Object.entries(request.params || {}).filter(([key, value]) => /id$/i.test(key) && typeof value === 'string'),
  );
}

export function requestLogger({ logger = console, now = () => new Date() } = {}) {
  return (request, response, next) => {
    request.requestId = requestIdFrom(request);
    response.setHeader('X-Request-Id', request.requestId);

    response.on('finish', () => {
      const route = routePattern(request);
      const timestamp = now().toISOString();
      const isAdminWrite = request.user?.role === 'Admin'
        && ['POST', 'PATCH', 'DELETE'].includes(request.method);
      const record = {
        event: 'http_request',
        timestamp,
        requestId: request.requestId,
        method: request.method,
        route,
        status: response.statusCode,
        userId: request.user?.id ?? null,
      };

      if (isAdminWrite) {
        Object.assign(record, {
          audit: true,
          actorId: request.user.id,
          role: request.user.role,
          targetIds: targetIds(request),
        });
      }
      if (response.locals.errorCode) record.errorCode = response.locals.errorCode;
      if (response.locals.errorName) record.errorName = response.locals.errorName;

      writeLog(logger, record);
    });

    next();
  };
}
