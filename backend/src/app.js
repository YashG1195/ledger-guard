import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { requestIdMiddleware } from './utils/requestId.js';
import { NotFoundError } from './utils/errors.js';
import { errorHandler } from './gateway/errorHandler.js';

import ledgerRoutes from './ledger/ledger.routes.js';
import analyticsRoutes from './analytics/analytics.routes.js';
import authRoutes from './gateway/auth.routes.js';
import { initSocketIO } from './realtime/socketHandler.js';

export function createApp() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  // security and parser middleware
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // trace request id and attach child logger
  app.use(requestIdMiddleware);

  // basic request timing logger
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      req.log.info(
        {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          elapsedMs: Date.now() - started,
        },
        'request completed'
      );
    });
    next();
  });

  // health probe
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: { status: 'ok', env: env.NODE_ENV, timestamp: new Date().toISOString() },
      error: null,
    });
  });

  // domain routers
  app.use('/auth', authRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/ledger', ledgerRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);

  // catch unmapped routes
  app.use((req, _res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
  });

  // centralized error handler
  app.use(errorHandler);

  initSocketIO(io);

  return { app, httpServer, io };
}
