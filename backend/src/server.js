import './config/env.js';

import { createApp } from './app.js';
import { disconnectAll } from './db/connectionManager.js';
import { disconnectRedis } from './config/redis.js';
import { loadKeys } from './crypto/keys.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';

async function bootstrap() {
  loadKeys();

  const { httpServer } = createApp();
  const port = Number(env.PORT) || 3000;

  httpServer.listen(port, () => {
    logger.info({ port, env: env.NODE_ENV }, `ledger-guard server listening on port ${port}`);
  });

  const stop = async (signal) => {
    logger.info({ signal }, 'shutting down server');
    httpServer.close(async () => {
      try {
        await disconnectAll();
        await disconnectRedis();
        logger.info('http server and database connections closed');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during graceful shutdown');
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error('force shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'failed to start application');
  process.exit(1);
});
