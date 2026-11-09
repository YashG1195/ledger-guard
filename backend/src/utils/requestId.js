import { randomUUID } from 'crypto';
import { childLogger } from './logger.js';

/**
 * Express middleware that:
 *  1. Generates a UUID v4 request ID (or reads X-Request-Id header if provided by upstream).
 *  2. Attaches it to req.id and res header X-Request-Id.
 *  3. Binds a pino child logger to req.log so every handler has a pre-bound logger.
 */
export function requestIdMiddleware(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  req.log = childLogger(id);
  next();
}

