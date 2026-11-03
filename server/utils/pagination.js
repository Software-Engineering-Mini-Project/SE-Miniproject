import { invalid, readFilterString } from './validation.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const LEGACY_LIST_LIMIT = 500;

function readPositiveInteger(query, key, fallback, max) {
  const value = readFilterString(query, key, 12);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    invalid(`${key} must be a number from 1 to ${max}.`, { [key]: `Enter a number from 1 to ${max}.` });
  }
  return parsed;
}

export function readListOptions(query) {
  const isPaged = query.page !== undefined || query.pageSize !== undefined;
  const pageSize = readPositiveInteger(query, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = readPositiveInteger(query, 'page', 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize));
  return {
    isPaged,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    limit: isPaged ? pageSize : LEGACY_LIST_LIMIT,
  };
}

