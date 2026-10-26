import mongoose from 'mongoose';

const defaultMessages = {
  400: 'Request validation failed.',
  404: 'Resource not found.',
  413: 'Request body is too large.',
};

function errorFields(error) {
  if (error.fields && typeof error.fields === 'object') return error.fields;
  if (error instanceof mongoose.Error.ValidationError) {
    return Object.fromEntries(Object.entries(error.errors).map(([key, item]) => [key, item.message]));
  }
  if (error instanceof mongoose.Error.CastError) return { [error.path]: 'Invalid value.' };
  return undefined;
}

function normalizeError(error) {
  if (error?.type === 'entity.parse.failed') {
    return { status: 400, errorCode: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' };
  }
  if (error?.type === 'entity.too.large') {
    return { status: 413, errorCode: 'VALIDATION_ERROR', message: defaultMessages[413] };
  }
  // Only the unique email index means a duplicate account; other duplicate keys are unexpected.
  if (error?.code === 11000 && error.keyPattern?.emailNormalized) {
    return {
      status: 409,
      errorCode: 'DUPLICATE_EMAIL',
      message: 'An account with this email already exists.',
      fields: { email: 'This email is already registered.' },
    };
  }
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return {
      status: 400,
      errorCode: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      fields: errorFields(error),
    };
  }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    const status = error.status;
    return {
      status,
      errorCode: error.code || (status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'),
      message: error.expose === false ? defaultMessages[status] || 'Request could not be processed.' : error.message,
      fields: errorFields(error),
    };
  }
  return { status: 500, errorCode: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
}

export function errorHandler({ now = () => new Date() } = {}) {
  return (error, request, response, _next) => {
    const normalized = normalizeError(error);
    response.locals.errorCode = normalized.errorCode;
    // The error name (e.g. TypeError) is safe to log; its message may contain data, so it is not.
    if (normalized.status === 500) response.locals.errorName = error?.name || 'Error';
    const body = {
      errorCode: normalized.errorCode,
      message: normalized.message,
      timestamp: now().toISOString(),
    };
    if (normalized.fields && Object.keys(normalized.fields).length > 0) body.fields = normalized.fields;

    response.status(normalized.status).json(body);
  };
}
