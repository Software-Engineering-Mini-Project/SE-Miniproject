export class HttpError extends Error {
  constructor(status, errorCode, message, fields) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = errorCode;
    this.fields = fields;
  }
}
