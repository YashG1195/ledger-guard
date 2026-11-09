import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { sendError } from '../utils/response.js';

/**
 * Central Express error-handling middleware.
 *
 * Rules:
 *  - AppError (isOperational = true) → expose message + code to client
 *  - Zod ValidationError coming from body parsing → 400
 *  - Everything else → generic 500 (message never exposed to client)
 *
 * Must be registered as the LAST middleware in app.js (4-param signature).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Use the per-request logger when available, fall back to root logger
  const log = req.log ?? logger;

  if (err instanceof AppError && err.isOperational) {
    // Known operational error — log at warn level
    log.warn({ err, requestId: req.id }, err.message);
    return sendError(res, err.code, err.message, err.details, err.statusCode);
  }

  // Unexpected error — log full stack at error level, never leak internals
  log.error({ err, requestId: req.id, stack: err.stack }, 'Unhandled error');

  return sendError(
    res,
    'INTERNAL_ERROR',
    'An unexpected error occurred. Please try again later.',
    null,
    500
  );
}

