/**
 * Unit tests for src/ledger/idempotency.js.
 *
 * Redis is mocked in-process — no live Redis required.
 * The mock faithfully implements SET NX PX semantics so the idempotency logic
 * is exercised end-to-end without network I/O.
 */

import { jest } from '@jest/globals';

// --- in-process Redis mock --------------------------------------------------

function createRedisMock() {
  const store = new Map(); // key -> { value, expiresAt }

  function isExpired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  return {
    store,

    async set(key, value, ...args) {
      let nx = false;
      let pxMs = null;
      let exSeconds = null;

      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === 'NX') nx = true;
        else if (a === 'PX') pxMs = Number(args[i + 1]);
        else if (a === 'EX') exSeconds = Number(args[i + 1]);
      }

      const existing = store.get(key);
      if (nx && existing && !isExpired(existing)) return null;

      const expiresAt =
        pxMs != null
          ? Date.now() + pxMs
          : exSeconds != null
            ? Date.now() + exSeconds * 1000
            : null;

      store.set(key, { value, expiresAt });
      return 'OK';
    },

    async setex(key, seconds, value) {
      store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
      return 'OK';
    },

    async get(key) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) return null;
      return entry.value;
    },

    async del(key) {
      return store.delete(key) ? 1 : 0;
    },

    // Lua compare-and-delete stub
    async eval(_script, _numKeys, key, argv) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) return 0;
      if (entry.value === argv) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------

let acquireLock, releaseLock, checkIdempotency, storeIdempotency, withIdempotency;

beforeAll(async () => {
  ({ acquireLock, releaseLock, checkIdempotency, storeIdempotency, withIdempotency } =
    await import('../src/ledger/idempotency.js'));
});

// ============================================================================
// acquireLock
// ============================================================================

describe('acquireLock', () => {
  test('returns a token when the lock is free', async () => {
    const redis = createRedisMock();
    const token = await acquireLock(redis, 'org1', 'key-a', 5000);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('returns null when the lock is already held', async () => {
    const redis = createRedisMock();
    await acquireLock(redis, 'org1', 'key-b', 5000);
    const second = await acquireLock(redis, 'org1', 'key-b', 5000);
    expect(second).toBeNull();
  });

  test('namespaces per tenant — different orgIds do not collide', async () => {
    const redis = createRedisMock();
    const t1 = await acquireLock(redis, 'org-alpha', 'shared-key', 5000);
    const t2 = await acquireLock(redis, 'org-beta', 'shared-key', 5000);
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
  });
});

// ============================================================================
// releaseLock
// ============================================================================

describe('releaseLock', () => {
  test('releases the lock when the caller owns it', async () => {
    const redis = createRedisMock();
    const token = await acquireLock(redis, 'org1', 'key-c', 5000);
    const released = await releaseLock(redis, 'org1', 'key-c', token);
    expect(released).toBe(true);

    // Lock is gone — another caller can now acquire
    const next = await acquireLock(redis, 'org1', 'key-c', 5000);
    expect(next).not.toBeNull();
  });

  test('does not release the lock when the token is wrong', async () => {
    const redis = createRedisMock();
    await acquireLock(redis, 'org1', 'key-d', 5000);
    const released = await releaseLock(redis, 'org1', 'key-d', 'wrong-token');
    expect(released).toBe(false);
  });
});

// ============================================================================
// checkIdempotency / storeIdempotency
// ============================================================================

describe('checkIdempotency / storeIdempotency', () => {
  test('returns null when no cached result exists', async () => {
    const redis = createRedisMock();
    const result = await checkIdempotency(redis, 'org1', 'missing-key');
    expect(result).toBeNull();
  });

  test('returns the stored result after storeIdempotency', async () => {
    const redis = createRedisMock();
    const payload = { transactionId: 'tx-123', status: 'completed' };
    await storeIdempotency(redis, 'org1', 'idem-key-1', payload);
    const result = await checkIdempotency(redis, 'org1', 'idem-key-1');
    expect(result).toEqual(payload);
  });
});

// ============================================================================
// withIdempotency — duplicate sequential requests
// ============================================================================

describe('withIdempotency — duplicate sequential requests', () => {
  test('second call gets the cached result without re-executing fn', async () => {
    const redis = createRedisMock();
    let execCount = 0;
    const fn = jest.fn(async () => {
      execCount++;
      return { transactionId: 'tx-seq-1', status: 'completed' };
    });

    const first = await withIdempotency(redis, 'org1', 'seq-key', 5000, fn);
    const second = await withIdempotency(redis, 'org1', 'seq-key', 5000, fn);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(execCount).toBe(1);
    expect(second.result).toEqual(first.result);
  });
});

// ============================================================================
// withIdempotency — 10 concurrent identical requests
// ============================================================================

describe('withIdempotency — 10 concurrent identical requests', () => {
  test('only one request executes; the rest replay or get a 409 conflict', async () => {
    const redis = createRedisMock();
    let execCount = 0;

    const fn = jest.fn(async () => {
      await new Promise((r) => setImmediate(r));
      execCount++;
      return { transactionId: 'tx-concurrent', status: 'completed' };
    });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withIdempotency(redis, 'org-concurrent', 'concurrent-key', 5000, fn),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // fn must have run exactly once
    expect(execCount).toBe(1);

    // All fulfilled results must carry the same transaction data
    for (const r of fulfilled) {
      expect(r.value.result.transactionId).toBe('tx-concurrent');
    }

    // Any rejections must be LOCK_CONFLICT (409), not an unexpected error
    for (const r of rejected) {
      expect(r.reason.code).toBe('LOCK_CONFLICT');
      expect(r.reason.statusCode).toBe(409);
    }
  });
});

// ============================================================================
// withIdempotency — lock expiry
// ============================================================================

describe('withIdempotency — lock expiry', () => {
  test('a request acquires a fresh lock after the previous one expired', async () => {
    const redis = createRedisMock();

    // Grab the lock with a 1 ms TTL and never release it
    const shortToken = await acquireLock(redis, 'org-exp', 'exp-key', 1);
    expect(shortToken).not.toBeNull();

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 20));

    let execCount = 0;
    const fn = jest.fn(async () => {
      execCount++;
      return { transactionId: 'tx-after-expiry', status: 'completed' };
    });

    const { result, replayed } = await withIdempotency(redis, 'org-exp', 'exp-key', 5000, fn);
    expect(replayed).toBe(false);
    expect(execCount).toBe(1);
    expect(result.transactionId).toBe('tx-after-expiry');
  });
});

// ============================================================================
// withIdempotency — Redis down (fail-closed)
// ============================================================================

describe('withIdempotency — Redis unavailable', () => {
  test('throws a 503 error and never calls fn when Redis is down', async () => {
    const brokenRedis = {
      get: async () => { throw new Error('ECONNREFUSED'); },
      set: async () => { throw new Error('ECONNREFUSED'); },
      setex: async () => { throw new Error('ECONNREFUSED'); },
      eval: async () => { throw new Error('ECONNREFUSED'); },
    };

    let executed = false;
    const fn = jest.fn(async () => {
      executed = true;
      return { transactionId: 'should-not-run' };
    });

    await expect(
      withIdempotency(brokenRedis, 'org-down', 'down-key', 5000, fn),
    ).rejects.toMatchObject({
      code: 'REDIS_DOWN',
      statusCode: 503,
    });

    expect(executed).toBe(false);
  });
});
