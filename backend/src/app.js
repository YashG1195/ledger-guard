import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestIdMiddleware } from './utils/requestId.js';
import { NotFoundError } from './utils/errors.js';
import { errorHandler } from './gateway/errorHandler.js';

// Domain routers
import ledgerRoutes from './ledger/ledger.routes.js';
import analyticsRoutes from './analytics/analytics.routes.js';

// Real-time
import { initSocketIO } from './realtime/socketHandler.js';

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  // ─── Security & Parsing ───────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // ─── Request ID + per-request logger ─────────────────────────────────────
  app.use(requestIdMiddleware);

  // ─── HTTP access log ──────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      req.log.info(
        {
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'HTTP request'
      );
    });
    next();
  });

  // ─── Health check (no auth) ───────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() },
      error: null,
    });
  });

  // ─── API routes ───────────────────────────────────────────────────────────
  app.use('/api/v1/ledger', ledgerRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);

  // ─── 404 catch-all ───────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    next(new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`));
  });

  // ─── Central error handler (must be last, 4-param) ───────────────────────
  app.use(errorHandler);

  // ─── Socket.io ────────────────────────────────────────────────────────────
  initSocketIO(io);

  return { app, httpServer, io };
}
