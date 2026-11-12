import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { getPublicKey } from '../crypto/keys.js';

export function initSocketIO(io) {
  io.use((socket, next) => {
    const rawToken =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/, '');

    if (!rawToken) {
      return next(new Error('Missing authentication token'));
    }

    const key = getPublicKey();
    if (!key) {
      return next(new Error('Auth keys not available'));
    }

    try {
      socket.user = jwt.verify(rawToken, key, { algorithms: ['RS256'] });
      next();
    } catch {
      next(new Error('Token verification failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.sub || socket.user?.id || 'unknown';
    const tenantId = socket.user?.tenantId;

    logger.info({ socketId: socket.id, userId, tenantId }, 'client connected to websocket');

    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
    }

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, 'client disconnected from websocket');
    });
  });
}

export function emitToTenant(io, tenantId, event, data) {
  io.to(`tenant:${tenantId}`).emit(event, data);
}
