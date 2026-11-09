// server.js is the process entry point.
// Import order matters: env must be validated before anything else loads.
import './config/env.js';

import { createApp } from './app.js';
import { connectDB } from './db/connectionManager.js';
import { loadKeys } from './crypto/keys.js';
import { logger } from './utils/logger.js';
import { env } from './config/env.js';

async function main() {
  // 1. Load RSA keys (soft fail — features that need them will fail at request time)
  loadKeys();

  // 2. Connect to MongoDB
  await connectDB();

  // 3. Create Express + Socket.io app
  const { httpServer } = createApp();

  // 4. Bind to port
  httpServer.listen(Number(env.PORT), () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `🚀  LedgerGuard started on port ${env.PORT}`
    );
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutdown signal received — draining connections…');
    httpServer.close(() => {
      logger.info('HTTP server closed cleanly');
      process.exit(0);
    });

    // Force-kill if shutdown hangs
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException — shutting down');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandledRejection — shutting down');
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
