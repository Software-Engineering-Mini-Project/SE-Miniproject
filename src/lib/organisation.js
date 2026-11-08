/**
 * Organisations: the top level of the app. Every account and every project belongs to exactly
 * one organisation, and nothing crosses between organisations. People join one with its invite
 * code (as Members) or start a new one (becoming its Admin).
 *
 * Shared by the API, the in-browser mock API and the UI. Runs in Node and in the browser.
 */

// No 0/O/1/I/L: codes get read aloud and typed by hand.
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 10;
export const JOIN_CODE_MIN = 6;
export const JOIN_CODE_MAX = 16;
export const ORGANISATION_NAME_MAX = 80;

/** Upper-case letters and digits only, so "acme-labs 26" and "ACMELABS26" are the same code. */
export function normalizeJoinCode(value) {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function isJoinCodeShape(code) {
  return code.length >= JOIN_CODE_MIN && code.length <= JOIN_CODE_MAX;
}

/** "ABCDEFGHJK" -> "ABCDE-FGHJK", for display. */
export function formatJoinCode(code) {
  const normalized = normalizeJoinCode(code);
  return normalized.length > 5 ? `${normalized.slice(0, 5)}-${normalized.slice(5)}` : normalized;
}

/** A random invite code. The alphabet has 32 symbols, so a masked random byte is unbiased. */
export function generateJoinCode() {
  const bytes = new Uint8Array(JOIN_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte & 31]).join('');
}
