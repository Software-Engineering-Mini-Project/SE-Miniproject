import dotenv from 'dotenv';

export class ConfigurationError extends Error {
  constructor(variable, reason) {
    super(`Invalid configuration for ${variable}: ${reason}`);
    this.name = 'ConfigurationError';
    this.variable = variable;
  }
}

function requiredString(source, key) {
  const value = source[key]?.trim();
  if (!value) throw new ConfigurationError(key, 'a value is required');
  return value;
}

function parsePort(value) {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError('PORT', 'must be an integer from 1 to 65535');
  }
  return port;
}

function parseMongoUri(value) {
  if (!/^mongodb(?:\+srv)?:\/\/\S+$/i.test(value)) {
    throw new ConfigurationError('MONGODB_URI', 'must be a MongoDB connection URI');
  }
  return value;
}

function parseCorsOrigins(value) {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new ConfigurationError('CORS_ORIGIN', 'at least one origin is required');

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigurationError('CORS_ORIGIN', 'each value must be an origin URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new ConfigurationError('CORS_ORIGIN', 'each value must be an origin URL');
    }
  }
  return origins;
}

export function parseEnvironment(source = process.env) {
  const mongoUri = parseMongoUri(requiredString(source, 'MONGODB_URI'));
  const jwtSecret = requiredString(source, 'JWT_SECRET');
  if (jwtSecret.length < 32) {
    throw new ConfigurationError('JWT_SECRET', 'must contain at least 32 characters');
  }

  const jwtExpiresIn = Number(source.JWT_EXPIRES_IN ?? 7200);
  if (!Number.isSafeInteger(jwtExpiresIn) || jwtExpiresIn < 60 || jwtExpiresIn > 86400) {
    throw new ConfigurationError('JWT_EXPIRES_IN', 'must be an integer from 60 to 86400 seconds');
  }

  return Object.freeze({
    port: parsePort(source.PORT),
    mongoUri,
    jwtSecret,
    jwtExpiresIn,
    corsOrigins: parseCorsOrigins(source.CORS_ORIGIN ?? 'http://localhost:3000'),
  });
}

export function loadEnvironment() {
  dotenv.config({ quiet: true });
  return parseEnvironment(process.env);
}
