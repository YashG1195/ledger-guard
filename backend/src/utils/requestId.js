import { randomUUID } from 'crypto';
import { childLogger } from './logger.js';

export function requestIdMiddleware(req, res, next) {
  const reqId = req.headers['x-request-id'] || randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  req.log = childLogger(reqId);
  next();
}
