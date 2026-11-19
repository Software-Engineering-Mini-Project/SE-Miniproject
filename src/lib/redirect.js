/**
 * Only allow same-site relative redirects after sign-in. Browsers treat a backslash like a slash,
 * so `/\evil.example` would leave the site; control characters are rejected for the same reason.
 */
export function safeNext(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
