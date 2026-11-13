import jwt from 'jsonwebtoken';
import { readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { env } from '../config/env.js';
import { sendError } from '../utils/response.js';

let cachedPublicKey = null;

function resolveKeyPath(filePath) {
  if (isAbsolute(filePath) && existsSync(filePath)) {
    return filePath;
  }
  const directPath = resolve(process.cwd(), filePath);
  if (existsSync(directPath)) return directPath;

  const backendSubdir = resolve(process.cwd(), 'backend', filePath);
  if (existsSync(backendSubdir)) return backendSubdir;

  return directPath;
}

export function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;

  const resolved = resolveKeyPath(env.JWT_PUBLIC_KEY_PATH);
  try {
    cachedPublicKey = readFileSync(resolved, 'utf8');
    return cachedPublicKey;
  } catch (err) {
    throw new Error(`Failed to load JWT public key from ${resolved}: ${err.message}`);
  }
}

// Reset key cache (helpful for test environments)
export function resetKeyCache() {
  cachedPublicKey = null;
}

export function authGateway(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return sendError(
      res,
      'UNAUTHORIZED',
      'Missing or malformed Authorization header',
      null,
      401
    );
  }

  const token = header.slice(7).trim();
  if (!token) {
    return sendError(
      res,
      'UNAUTHORIZED',
      'Bearer token is missing',
      null,
      401
    );
  }

  let publicKey;
  try {
    publicKey = getPublicKey();
  } catch (err) {
    req.log?.error({ err }, 'public key unavailable');
    return sendError(
      res,
      'SERVICE_UNAVAILABLE',
      'Authentication service key unavailable',
      null,
      503
    );
  }

  try {
    // strictly enforce RS256 to prevent algorithm confusion attacks (e.g. HS256 with public key as HMAC secret)
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    });

    if (!payload.orgId || !payload.sub) {
      return sendError(
        res,
        'INVALID_TOKEN',
        'Token payload missing required claims',
        null,
        401
      );
    }

    req.tenant = {
      orgId: payload.orgId,
      userId: payload.sub,
      role: payload.role || 'member',
    };

    // keep backward-compatible fields
    req.user = payload;
    req.tenantId = payload.orgId;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendError(
        res,
        'TOKEN_EXPIRED',
        'Token has expired',
        { expiredAt: err.expiredAt },
        401
      );
    }

    return sendError(
      res,
      'INVALID_TOKEN',
      'Token is invalid',
      null,
      401
    );
  }
}

