/**
 * HTTP smoke tests for POST /api/v1/ledger/charge.
 *
 * Uses jest.unstable_mockModule to intercept the connectionManager so no
 * live MongoDB or Redis is needed. ESM mock hoisting requires all imports
 * to be dynamic (after the mock declaration).
 */

import { jest } from '@jest/globals';

// Fake in-process Redis store
function makeRedisStore() {
  const store = new Map();
  const isExpired = (e) => e.expiresAt !== null && Date.now() > e.expiresAt;
  return {
    store,
    async set(key, value, ...args) {
      let nx = false; let pxMs = null;
      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === 'NX') nx = true;
        else if (a === 'PX') pxMs = Number(args[i + 1]);
      }
      const existing = store.get(key);
      if (nx && existing && !isExpired(existing)) return null;
      store.set(key, { value, expiresAt: pxMs != null ? Date.now() + pxMs : null });
      return 'OK';
    },
    async setex(key, sec, value) {
      store.set(key, { value, expiresAt: Date.now() + sec * 1000 });
      return 'OK';
    },
    async get(key) {
      const e = store.get(key);
      return !e || isExpired(e) ? null : e.value;
    },
    async eval(_s, _n, key, argv) {
      const e = store.get(key);
      if (!e || isExpired(e)) return 0;
      if (e.value === argv) { store.delete(key); return 1; }
      return 0;
    },
  };
}

// Mock ioredis config so no real Redis connection is opened
jest.unstable_mockModule('../src/config/redis.js', async () => {
  const redis = makeRedisStore();
  return { getRedis: () => redis, disconnectRedis: async () => {} };
});

// Mock connectionManager so no real Mongo connection is opened
jest.unstable_mockModule('../src/db/connectionManager.js', async () => {
  const fakeConn = { model: () => ({}), readyState: 1 };
  return {
    connectionManager: {
      getTenantConnection: async () => fakeConn,
      disconnectAll: async () => {},
      listActive: () => [],
    },
    tenantContext: (req, _res, next) => {
      req.db = fakeConn;
      req.models = {};
      next();
    },
  };
});

// All imports must be dynamic (after mocks above) for ESM mock hoisting to work
const { createApp } = await import('../src/app.js');
const { readFileSync } = await import('fs');
const path = await import('path');
const jwt = (await import('jsonwebtoken')).default;
const request = (await import('supertest')).default;

function resolveKey(envVar, filename) {
  const p = process.env[envVar] ?? path.default.resolve('keys', filename);
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return readFileSync(path.default.resolve('backend', 'keys', filename), 'utf8');
  }
}

function mintToken(overrides = {}) {
  const privateKey = resolveKey('JWT_PRIVATE_KEY_PATH', 'private.pem');
  return jwt.sign(
    { sub: 'usr-charge-test', orgId: 'org_charge_test', role: 'billing_manager', ...overrides },
    privateKey,
    { algorithm: 'RS256', expiresIn: '15m' },
  );
}

let app;
let token;

beforeAll(() => {
  ({ app } = createApp());
  token = mintToken();
});

describe('POST /api/v1/ledger/charge', () => {
  test('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Idempotency-Key', 'test-key-no-auth')
      .send({ amount: 50 });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('returns 400 when Idempotency-Key header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, currency: 'USD' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  test('returns 400 when Idempotency-Key header is blank', async () => {
    const res = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', '   ')
      .send({ amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  test('returns 201 and a transaction on a valid first request', async () => {
    const res = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'valid-charge-key-001')
      .send({ amount: 99.99, currency: 'USD', description: 'Pro plan' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionId).toBeDefined();
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.amount).toBe(9999); // minor units
    expect(res.headers['idempotency-replayed']).toBe('false');
  });

  test('replays the original result on a duplicate request', async () => {
    const idemKey = 'valid-charge-key-002';
    const payload = { amount: 25, currency: 'EUR' };

    const first = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idemKey)
      .send(payload);

    expect(first.status).toBe(201);
    const originalTxId = first.body.data.transactionId;

    const second = await request(app)
      .post('/api/v1/ledger/charge')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idemKey)
      .send(payload);

    expect(second.status).toBe(200); // replay → 200
    expect(second.body.data.transactionId).toBe(originalTxId);
    expect(second.headers['idempotency-replayed']).toBe('true');
  });
});
