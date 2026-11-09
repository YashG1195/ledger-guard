import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Root logger — used directly in non-request contexts (startup, DB, etc.)
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
  base: { service: 'ledger-guard' },
});

/**
 * Creates a child logger bound to a specific request ID.
 * @param {string} requestId
 */
export const childLogger = (requestId) => logger.child({ requestId });
