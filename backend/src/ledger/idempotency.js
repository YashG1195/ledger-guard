import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';

// Lua script for atomic compare-and-delete — only the lock owner can release.
// This prevents a slow process from releasing a lock that has already expired
// and been acquired by a different process.
const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const IDEM_TTL_SECONDS = 86400; // 24 hours
const LOCK_KEY_PREFIX = 'lock';
const IDEM_KEY_PREFIX = 'idem';

function lockKey(orgId, key) {
  return `${LOCK_KEY_PREFIX}:${orgId}:${key}`;
}

function idemKey(orgId, idempotencyKey) {
  return `${IDEM_KEY_PREFIX}:${orgId}:${idempotencyKey}`;
}

/**
 * Attempts to acquire a Redis-based mutex lock via SET NX PX.
 * Returns a unique token string on success, or null if the lock is already held.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} orgId - Namespace prevents cross-tenant collisions
 * @param {string} key   - Resource identifier (e.g. idempotency key)
 * @param {number} ttlMs - Lock TTL in milliseconds
 * @returns {Promise<string|null>} owner token or null if not acquired
 */
export async function acquireLock(redis, orgId, key, ttlMs) {
  const token = randomBytes(24).toString('hex');
  const result = await redis.set(lockKey(orgId, key), token, 'NX', 'PX', ttlMs);
  return result === 'OK' ? token : null;
}

/**
 * Releases a lock only if the caller still owns it (compare-and-delete via Lua).
 * Returns true if the lock was released, false if it was already expired or held by someone else.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} orgId
 * @param {string} key
 * @param {string} token - Must match the token returned by acquireLock
 * @returns {Promise<boolean>}
 */
export async function releaseLock(redis, orgId, key, token) {
  const released = await redis.eval(RELEASE_LUA, 1, lockKey(orgId, key), token);
  return released === 1;
}

/**
 * Checks whether a completed result exists in the idempotency cache.
 * If found, the original response payload is returned so the caller can
 * short-circuit and replay it without re-executing the operation.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} orgId
 * @param {string} idempotencyKey
 * @returns {Promise<object|null>}
 */
export async function checkIdempotency(redis, orgId, idempotencyKey) {
  const raw = await redis.get(idemKey(orgId, idempotencyKey));
  return raw ? JSON.parse(raw) : null;
}

/**
 * Stores a completed result in the idempotency cache with a 24-hour TTL.
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} orgId
 * @param {string} idempotencyKey
 * @param {object} result
 */
export async function storeIdempotency(redis, orgId, idempotencyKey, result) {
  await redis.setex(idemKey(orgId, idempotencyKey), IDEM_TTL_SECONDS, JSON.stringify(result));
}

/**
 * Wraps a payment/charge handler with:
 *  1. Idempotency-Key header validation (400 if missing on mutating requests)
 *  2. Idempotency cache check — replays prior result immediately
 *  3. Per-tenant distributed lock (fail-closed if Redis is down → 503)
 *  4. Single-execution guarantee under concurrent identical requests
 *
 * Usage:
 *   const result = await withIdempotency(redis, orgId, idempotencyKey, lockTtlMs, async () => {
 *     return await processPayment(data);
 *   });
 *
 * @param {import('ioredis').Redis} redis
 * @param {string} orgId
 * @param {string} idempotencyKey
 * @param {number} lockTtlMs
 * @param {() => Promise<object>} fn - The operation to protect
 * @returns {Promise<{ result: object, replayed: boolean }>}
 */
export async function withIdempotency(redis, orgId, idempotencyKey, lockTtlMs, fn) {
  // Check for a previously completed result first (no lock needed for cache reads).
  // If Redis itself is down here, fail closed — we can't safely proceed without it.
  let cached;
  try {
    cached = await checkIdempotency(redis, orgId, idempotencyKey);
  } catch (err) {
    logger.error({ err, orgId, idempotencyKey }, 'redis unavailable during cache check');
    const redisDownError = new Error('Redis unavailable — cannot safely process payment');
    redisDownError.code = 'REDIS_DOWN';
    redisDownError.statusCode = 503;
    throw redisDownError;
  }

  if (cached) {
    logger.info({ orgId, idempotencyKey }, 'idempotency cache hit — replaying result');
    return { result: cached, replayed: true };
  }

  // Try to acquire the per-key lock. If Redis is unavailable this will throw,
  // which is intentional — we never execute the payment unprotected.
  let token;
  try {
    token = await acquireLock(redis, orgId, idempotencyKey, lockTtlMs);
  } catch (err) {
    logger.error({ err, orgId, idempotencyKey }, 'redis unavailable during lock acquire');
    const redisDownError = new Error('Redis unavailable — cannot safely process payment');
    redisDownError.code = 'REDIS_DOWN';
    redisDownError.statusCode = 503;
    throw redisDownError;
  }

  if (!token) {
    // Another request with the same key won the lock — it is currently executing.
    // Check the cache one more time in case it just finished.
    const raceResult = await checkIdempotency(redis, orgId, idempotencyKey).catch(() => null);
    if (raceResult) {
      return { result: raceResult, replayed: true };
    }

    // Lock held but no result yet — tell the caller to retry after a short delay
    const conflictError = new Error('Request in progress — retry after the first completes');
    conflictError.code = 'LOCK_CONFLICT';
    conflictError.statusCode = 409;
    throw conflictError;
  }

  // We hold the lock — perform the operation
  try {
    const result = await fn();
    // Persist result before releasing so concurrent waiters can replay it
    await storeIdempotency(redis, orgId, idempotencyKey, result);
    return { result, replayed: false };
  } finally {
    // Always release. If the lock expired during a slow operation, this is a no-op.
    await releaseLock(redis, orgId, idempotencyKey, token).catch((err) => {
      logger.warn({ err, orgId, idempotencyKey }, 'could not release lock');
    });
  }
}

export { IDEM_TTL_SECONDS };
