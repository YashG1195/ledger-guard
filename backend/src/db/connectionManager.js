import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(env.MONGO_BASE_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    logger.info({ uri: env.MONGO_BASE_URI }, 'mongodb connected');

    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'mongodb runtime error');
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.warn('mongodb disconnected');
    });
  } catch (err) {
    logger.fatal({ err }, 'failed to connect to mongodb');
    process.exit(1);
  }
}

export async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('mongodb disconnected');
}

export function getTenantDB(tenantId) {
  return mongoose.connection.useDb(`ledgerguard_${tenantId}`, { useCache: true });
}
