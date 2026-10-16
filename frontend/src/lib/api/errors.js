// Shared API error envelope: { errorCode, message, timestamp } (SRS §3.2, SAD §4.1).

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status (0 when the server could not be reached)
   * @param {{ errorCode?: string, message?: string, timestamp?: string, fields?: Record<string, string> } | null} payload
   */
  constructor(status, payload) {
    super(payload?.message || 'Request failed');
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = payload?.errorCode || 'UNKNOWN_ERROR';
    this.timestamp = payload?.timestamp;
    this.fields = payload?.fields;
  }

  get isAuthError() {
    return this.status === 401;
  }
}

/** Human-readable fallback per status, used when the server message is missing. */
export function describeError(error) {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (error.message && error.message !== 'Request failed') return error.message;
  switch (error.status) {
    case 400:
      return 'Some fields are invalid.';
    case 401:
      return 'Your session has ended. Sign in again.';
    case 403:
      return 'You do not have access to this.';
    case 404:
      return 'This item no longer exists.';
    case 409:
      return 'That conflicts with an existing record.';
    case 429:
      return 'Too many attempts. Wait a minute and try again.';
    default:
      return 'Something went wrong on the server. Try again.';
  }
}
