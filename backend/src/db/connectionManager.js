import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let isConnected = false;

/**
 * Connect to MongoDB.
 * In a multi-tenant setup the base URI is shared; individual tenant databases
 * are selected at query time via mongoose.connection.useDb(tenantId).
 */
export async function connectDB() {
  if (isConnected) return;

  try {
    // Connect to the base URI — no specific database selected here
    await mongoose.connect(env.MONGO_BASE_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    logger.info({ uri: env.MONGO_BASE_URI }, 'MongoDB connected');

    mongoose.connection.on('error', (err) =>
      logger.error({ err }, 'MongoDB runtime error')
    );
    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.warn('MongoDB disconnected');
    });
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to MongoDB — shutting down');
    process.exit(1);
  }
}

export async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB connection closed');
}

/**
 * Returns a tenant-scoped Mongoose connection.
 * @param {string} tenantId
 */
export function getTenantDB(tenantId) {
  return mongoose.connection.useDb(`ledgerguard_${tenantId}`, { useCache: true });
}
