import './config/env.js';

import { createApp } from './app.js';
import { connectDB } from './db/connectionManager.js';
import { loadKeys } from './crypto/keys.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';

async function bootstrap() {
  loadKeys();
  await connectDB();

  const { httpServer } = createApp();
  const port = Number(env.PORT) || 3000;

  httpServer.listen(port, () => {
    logger.info({ port, env: env.NODE_ENV }, `ledger-guard server listening on port ${port}`);
  });

  const stop = (signal) => {
    logger.info({ signal }, 'shutting down server');
    httpServer.close(() => {
      logger.info('http server closed');
      process.exit(0);
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
