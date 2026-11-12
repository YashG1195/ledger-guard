import Redis from 'ioredis';
import Redlock from 'redlock';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient = null;
let redlockClient = null;

export function getRedis() {
  if (redisClient) return redisClient;

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redisClient.on('connect', () => logger.info('redis connected'));
  redisClient.on('ready', () => logger.info('redis ready'));
  redisClient.on('error', (err) => logger.error({ err }, 'redis error'));
  redisClient.on('close', () => logger.warn('redis connection closed'));
  redisClient.on('reconnecting', () => logger.warn('redis reconnecting'));

  return redisClient;
}

export function getRedlock() {
  if (redlockClient) return redlockClient;

  redlockClient = new Redlock([getRedis()], {
    retryCount: 3,
    retryDelay: 200,
    retryJitter: 100,
    automaticExtensionThreshold: 500,
  });

  redlockClient.on('error', (err) => {
    logger.error({ err }, 'redlock error');
  });

  return redlockClient;
}

export async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redlockClient = null;
    logger.info('redis disconnected');
  }
}
