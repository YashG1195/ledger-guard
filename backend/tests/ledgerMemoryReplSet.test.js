/**
 * Integration tests using mongodb-memory-server with a single-node replica set.
 *
 * Validates real MongoDB transaction semantics against WiredTiger replica sets:
 * 1. Failure (simulated timeout or insufficient funds) leaves account balance completely unchanged.
 * 2. Duplicate idempotency key never double-charges the account.
 * 3. Parallel requests with identical idempotency keys execute safely (single-execution guarantee).
 */

import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { processCharge } from '../src/ledger/ledger.service.js';
import { tenantSchemas } from '../src/db/schemas/index.js';

jest.setTimeout(300_000);

function createRedisMock() {
  const store = new Map();

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

describe('processCharge with MongoDB replica set transactions', () => {
  let replSet;
  let conn;
  let redis;
  let Ledger;
  let Transaction;

  beforeAll(async () => {
    // Generous timeout for initial binary download + replSet election
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const uri = replSet.getUri();
    conn = mongoose.createConnection(uri, {
      dbName: 'tenant_replset_test',
    });
    await conn.asPromise();

    for (const [name, schema] of Object.entries(tenantSchemas)) {
      conn.model(name, schema);
    }

    Ledger = conn.model('Ledger');
    Transaction = conn.model('Transaction');
  }, 300_000);

  afterAll(async () => {
    if (conn) await conn.close();
    if (replSet) await replSet.stop();
  }, 60_000);

  beforeEach(async () => {
    redis = createRedisMock();
    await Ledger.deleteMany({});
    await Transaction.deleteMany({});
  });

  test('failure (simulated timeout) leaves ledger balance unchanged and records failed transaction', async () => {
    const accountId = 'acc_fail_timeout';
    await Ledger.create({ accountId, balance: 10_000, version: 0 });

    let thrown;
    try {
      await processCharge(conn, {
        accountId,
        amount: 2500,
        idempotencyKey: 'idem_fail_1',
        simulateTimeout: true,
        redis,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('NETWORK_TIMEOUT');

    // Balance remains 10,000 (transaction rolled back)
    const ledger = await Ledger.findOne({ accountId });
    expect(ledger.balance).toBe(10_000);
    expect(ledger.version).toBe(0);

    // Failed transaction document recorded outside transaction
    const failedTx = await Transaction.findOne({ idempotencyKey: 'idem_fail_1' });
    expect(failedTx).not.toBeNull();
    expect(failedTx.status).toBe('failed');
    expect(failedTx.metadata.failureReason).toBe('Simulated network timeout');

    // Redis lock was released in finally block
    const lock = await redis.get('lock:replset_test:idem_fail_1');
    expect(lock).toBeNull();
  });

  test('failure (insufficient funds) leaves ledger balance unchanged', async () => {
    const accountId = 'acc_fail_funds';
    await Ledger.create({ accountId, balance: 1500, version: 0 });

    let thrown;
    try {
      await processCharge(conn, {
        accountId,
        amount: 5000,
        idempotencyKey: 'idem_fail_funds_2',
        redis,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown.code).toBe('INSUFFICIENT_FUNDS');
    expect(thrown.statusCode).toBe(422);

    const ledger = await Ledger.findOne({ accountId });
    expect(ledger.balance).toBe(1500);

    const failedTx = await Transaction.findOne({ idempotencyKey: 'idem_fail_funds_2' });
    expect(failedTx.status).toBe('failed');
  });

  test('duplicate key never double-charges the account', async () => {
    const accountId = 'acc_dup_test';
    const idempotencyKey = 'idem_duplicate_charge_001';
    await Ledger.create({ accountId, balance: 10_000, version: 0 });

    const first = await processCharge(conn, {
      accountId,
      amount: 3500,
      idempotencyKey,
      redis,
    });

    expect(first.status).toBe('completed');
    expect(first.balance).toBe(6500);
    expect(first.replayed).toBe(false);

    let ledger = await Ledger.findOne({ accountId });
    expect(ledger.balance).toBe(6500);
    expect(ledger.version).toBe(1);

    // Second call with duplicate idempotency key
    const second = await processCharge(conn, {
      accountId,
      amount: 3500,
      idempotencyKey,
      redis,
    });

    expect(second.status).toBe('completed');
    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);

    // Balance remains 6500 — account was NOT charged twice
    ledger = await Ledger.findOne({ accountId });
    expect(ledger.balance).toBe(6500);
    expect(ledger.version).toBe(1);

    // Only one transaction document exists
    const totalTransactions = await Transaction.countDocuments({ idempotencyKey });
    expect(totalTransactions).toBe(1);
  });

  test('parallel requests are safe and charge the account exactly once', async () => {
    const accountId = 'acc_parallel_test';
    const idempotencyKey = 'idem_parallel_001';
    await Ledger.create({ accountId, balance: 10_000, version: 0 });

    // Fire 10 parallel requests with the identical idempotency key
    const calls = Array.from({ length: 10 }, () =>
      processCharge(conn, {
        accountId,
        amount: 2000,
        idempotencyKey,
        redis,
      })
    );

    const results = await Promise.allSettled(calls);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // At least one fulfilled successfully
    expect(fulfilled.length).toBeGreaterThan(0);

    const executed = fulfilled.filter((r) => !r.value.replayed);
    expect(executed.length).toBe(1); // exactly one performed the real execution

    // All rejections (if any) are lock conflicts (409)
    for (const r of rejected) {
      expect(r.reason.code).toBe('LOCK_CONFLICT');
      expect(r.reason.statusCode).toBe(409);
    }

    // Crucial check: balance decremented exactly once (10000 - 2000 = 8000)
    const ledger = await Ledger.findOne({ accountId });
    expect(ledger.balance).toBe(8000);
    expect(ledger.version).toBe(1);

    // Only one transaction document recorded
    const count = await Transaction.countDocuments({ idempotencyKey, status: 'completed' });
    expect(count).toBe(1);
  });
});
