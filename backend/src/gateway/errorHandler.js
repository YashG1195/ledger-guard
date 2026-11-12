import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { sendError } from '../utils/response.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const log = req.log || logger;

  if (err instanceof AppError && err.isOperational) {
    log.warn({ err, requestId: req.id }, err.message);
    return sendError(res, err.code, err.message, err.details, err.statusCode);
  }

  log.error({ err, requestId: req.id, stack: err.stack }, 'unexpected server error');

  return sendError(
    res,
    'INTERNAL_ERROR',
    'An unexpected error occurred. Please try again later.',
    null,
    500
  );
}
