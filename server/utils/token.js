import jwt from 'jsonwebtoken';

export const TOKEN_TTL_SECONDS = 7200;

/** Signs a session token for `user`; `tv` ties it to the user's current token version. */
export function issueToken(user, { jwtSecret, jwtExpiresIn = TOKEN_TTL_SECONDS }) {
  const token = jwt.sign({ tv: user.tokenVersion ?? 0 }, jwtSecret, {
    subject: String(user.id ?? user._id),
    expiresIn: jwtExpiresIn,
    algorithm: 'HS256',
  });
  return { token, expiresIn: jwtExpiresIn };
}
