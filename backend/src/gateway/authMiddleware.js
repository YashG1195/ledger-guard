import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

let publicKey;

function getPublicKey() {
  if (!publicKey) {
    try {
      publicKey = readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), 'utf8');
    } catch {
      throw new UnauthorizedError('JWT public key unavailable');
    }
  }
  return publicKey;
}

/**
 * Verifies the Bearer JWT in Authorization header.
 * Sets req.user = decoded payload on success.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    req.log.debug({ sub: req.user.sub }, 'JWT verified');
    next();
  } catch (err) {
    throw new UnauthorizedError(
      err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token'
    );
  }
});
