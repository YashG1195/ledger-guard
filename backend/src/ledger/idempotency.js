export class IdempotencyService {
  constructor(redis, ttlSeconds = 86400) {
    this.redis = redis;
    this.ttl = ttlSeconds;
  }

  buildKey(tenantId, idempotencyKey) {
    return `idempotency:${tenantId}:${idempotencyKey}`;
  }

  async get(tenantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const value = await this.redis.get(this.buildKey(tenantId, idempotencyKey));
    return value ? JSON.parse(value) : null;
  }

  async set(tenantId, idempotencyKey, payload) {
    if (!idempotencyKey) return;
    await this.redis.setex(
      this.buildKey(tenantId, idempotencyKey),
      this.ttl,
      JSON.stringify(payload)
    );
  }

  async del(tenantId, idempotencyKey) {
    if (!idempotencyKey) return;
    await this.redis.del(this.buildKey(tenantId, idempotencyKey));
  }
}
