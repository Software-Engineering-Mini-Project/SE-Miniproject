import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { HttpError } from '../utils/http-error.js';

export function authenticate({ jwtSecret }) {
  return async (request, _response, next) => {
    const header = request.get('authorization');
    if (!header) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.'));

    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return next(new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.'));

    let payload;
    try {
      payload = jwt.verify(match[1], jwtSecret, { algorithms: ['HS256'] });
    } catch (error) {
      const expired = error?.name === 'TokenExpiredError';
      return next(new HttpError(
        401,
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'Your session has expired. Sign in again.' : 'Your session is invalid. Sign in again.',
      ));
    }

    if (typeof payload?.sub !== 'string') {
      return next(new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.'));
    }

    const user = await User.findById(payload.sub);
    if (!user) return next(new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid. Sign in again.'));

    request.user = { id: user.id, role: user.role };
    request.authUser = user;
    return next();
  };
}
