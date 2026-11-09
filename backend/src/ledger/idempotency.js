/**
 * Redis-backed idempotency store.
 *
 * Idempotency-Key header format: any opaque string (UUID recommended).
 * Keys are namespaced per tenant so a key collision across tenants is impossible.
 *
 * Usage:
 *   const idempotency = new IdempotencyService(redisClient);
 *   const cached = await idempotency.get(tenantId, key);
 *   if (cached) return cached;
 *   const result = await doWork();
 *   await idempotency.set(tenantId, key, result);
 */
export class IdempotencyService {
  /**
   * @param {import('ioredis').Redis} redis
   * @param {number} [ttl=86400]  TTL in seconds (default 24 h)
   */
  constructor(redis, ttl = 86_400) {
    this.redis = redis;
    this.ttl = ttl;
  }

  #key(tenantId, idempotencyKey) {
    return `idempotency:${tenantId}:${idempotencyKey}`;
  }

  /**
   * Retrieve a previously stored response, or null if not found.
   * @param {string} tenantId
   * @param {string|null} idempotencyKey
   * @returns {Promise<any|null>}
   */
  async get(tenantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const raw = await this.redis.get(this.#key(tenantId, idempotencyKey));
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Store a response under an idempotency key.
   * @param {string} tenantId
   * @param {string|null} idempotencyKey
   * @param {any} response
   */
  async set(tenantId, idempotencyKey, response) {
    if (!idempotencyKey) return;
    await this.redis.setex(
      this.#key(tenantId, idempotencyKey),
      this.ttl,
      JSON.stringify(response)
    );
  }

  /**
   * Delete an idempotency entry (e.g., after a rollback).
   * @param {string} tenantId
   * @param {string} idempotencyKey
   */
  async del(tenantId, idempotencyKey) {
    await this.redis.del(this.#key(tenantId, idempotencyKey));
  }
}
