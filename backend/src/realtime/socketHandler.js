import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { getPublicKey } from '../crypto/keys.js';

/**
 * Initialises all Socket.io server-side logic.
 * @param {import('socket.io').Server} io
 */
export function initSocketIO(io) {
  // ── JWT authentication middleware ────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ??
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('Authentication required'));

    const publicKey = getPublicKey();
    if (!publicKey) return next(new Error('Server key unavailable'));

    try {
      socket.user = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.user?.sub ?? socket.user?.id ?? 'unknown';
    const tenantId = socket.user?.tenantId;

    logger.info({ socketId: socket.id, userId, tenantId }, 'Socket connected');

    // Every socket joins its tenant's room for broadcast targeting
    if (tenantId) socket.join(`tenant:${tenantId}`);

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, 'Socket disconnected');
    });
  });
}

/**
 * Broadcast an event to all sockets in a tenant room.
 * @param {import('socket.io').Server} io
 * @param {string} tenantId
 * @param {string} event
 * @param {any}    data
 */
export function emitToTenant(io, tenantId, event, data) {
  io.to(`tenant:${tenantId}`).emit(event, data);
}
