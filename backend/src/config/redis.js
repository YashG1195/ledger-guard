import Redis from 'ioredis';
import Redlock from 'redlock';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

// ── Singleton Redis client ───────────────────────────────────────────────────
let _redis = null;
let _redlock = null;

export function getRedis() {
  if (_redis) return _redis;

  _redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  _redis.on('connect', () => logger.info('Redis connected'));
  _redis.on('ready', () => logger.info('Redis ready'));
  _redis.on('error', (err) => logger.error({ err }, 'Redis error'));
  _redis.on('close', () => logger.warn('Redis connection closed'));
  _redis.on('reconnecting', () => logger.warn('Redis reconnecting…'));

  return _redis;
}

/**
 * Redlock — distributed mutual exclusion over Redis.
 *
 * Usage:
 *   const lock = await getRedlock().acquire(['locks:tenant:accountId'], 5000);
 *   try { ... } finally { await lock.release(); }
 */
export function getRedlock() {
  if (_redlock) return _redlock;

  _redlock = new Redlock([getRedis()], {
    // Retry acquiring a lock up to 3 times with exponential backoff
    retryCount: 3,
    retryDelay: 200,   // ms
    retryJitter: 100,  // ms
    automaticExtensionThreshold: 500, // ms before expiry to auto-extend
  });

  _redlock.on('error', (err) => {
    // Only log — don't crash; callers handle LockError
    logger.error({ err }, 'Redlock error');
  });

  return _redlock;
}

export async function disconnectRedis() {
  if (_redis) {
    await _redis.quit();
    _redis = null;
    _redlock = null;
    logger.info('Redis disconnected');
  }
}
