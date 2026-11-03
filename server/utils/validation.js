import { HttpError } from './http-error.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export function invalid(message, fields) {
  throw new HttpError(400, 'VALIDATION_ERROR', message, fields);
}

export function requireObject(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value;
}

export function readString(object, key, {
  required = true,
  min = 1,
  max = 200,
  trim = true,
  allowEmpty = false,
  label = key,
} = {}) {
  const value = object?.[key];
  if (value === undefined) {
    if (required) invalid(`${label} is required.`, { [key]: `${label} is required.` });
    return undefined;
  }
  if (typeof value !== 'string') invalid(`${label} must be text.`, { [key]: `${label} must be text.` });
  const normalized = trim ? value.trim() : value;
  if ((!allowEmpty && normalized.length < min) || normalized.length > max) {
    const message = normalized.length > max
      ? `${label} must be ${max} characters or fewer.`
      : `${label} is required.`;
    invalid(message, { [key]: message });
  }
  return normalized;
}

export function readEmail(object, key = 'email') {
  const email = readString(object, key, { min: 3, max: 254, label: 'Email' });
  if (!EMAIL_PATTERN.test(email)) invalid('Enter a valid email address.', { [key]: 'Enter a valid email address.' });
  return email;
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function readPassword(object, key = 'password') {
  const password = readString(object, key, {
    min: PASSWORD_MIN,
    max: PASSWORD_MAX,
    trim: false,
    label: 'Password',
  });
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    invalid('Password must be 8–128 characters and include a letter and a number.', {
      [key]: 'Use 8+ characters with a letter and a number.',
    });
  }
  return password;
}

export function readId(value, label = 'Resource') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid(`Invalid ${label.toLowerCase()} id.`);
  return value;
}

export function readEnum(object, key, allowed, { required = true, label = key } = {}) {
  const value = object?.[key];
  if (value === undefined) {
    if (required) invalid(`${label} is required.`, { [key]: `${label} is required.` });
    return undefined;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    invalid(`${label} must be one of: ${allowed.join(', ')}.`, { [key]: `Choose ${allowed.join(', ')}.` });
  }
  return value;
}

export function readStringArray(object, key, { max = 100 } = {}) {
  const value = object?.[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string')) {
    invalid(`${key} must be a list of valid ids.`, { [key]: 'Choose valid project members.' });
  }
  const ids = [...new Set(value)];
  for (const id of ids) readId(id, key === 'assigneeIds' ? 'Assignee' : 'Member');
  return ids;
}

export function readDateOnly(object, key = 'dueDate') {
  const value = object?.[key];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid('Due date must be a valid date.', { [key]: 'Enter a valid date.' });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    invalid('Due date must be a valid date.', { [key]: 'Enter a valid date.' });
  }
  return value;
}

export function readFilterString(query, key, max = 200) {
  const value = query?.[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') invalid(`${key} must be text.`, { [key]: `${key} must be text.` });
  const normalized = value.trim();
  if (normalized.length > max) invalid(`${key} must be ${max} characters or fewer.`, { [key]: `Use ${max} characters or fewer.` });
  return normalized || undefined;
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function passwordStrength(password) {
  return typeof password === 'string'
    && password.length >= PASSWORD_MIN
    && password.length <= PASSWORD_MAX
    && /[A-Za-z]/.test(password)
    && /\d/.test(password);
}
