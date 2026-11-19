/**
 * Unit tests for processCharge in src/ledger/ledger.service.js.
 *
 * Exercises the complete multi-tenant ledger charge lifecycle:
 * 1. Redis distributed lock acquisition
 * 2. MongoDB session and withTransaction lifecycle
 * 3. Pending transaction insertion, ledger balance decrement, and completion
 * 4. Automatic transaction abort, failed transaction recording outside session, and lock release
 * 5. Redis idempotency cache and replays
 */

import { jest } from '@jest/globals';
import { processCharge } from '../src/ledger/ledger.service.js';

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

function createTenantConnectionMock() {
  const ledgerAccounts = new Map();
  const transactions = [];

  let sessionCount = 0;
  let activeSession = null;

  class LedgerDocument {
    constructor(data) {
      this.accountId = data.accountId;
      this.balance = data.balance ?? 0;
      this.version = data.version ?? 0;
      this.updatedAt = data.updatedAt ?? new Date();
    }

    async save(opts = {}) {
      const current = ledgerAccounts.get(this.accountId) || {};
      ledgerAccounts.set(this.accountId, {
        ...current,
        balance: this.balance,
        version: this.version,
        updatedAt: this.updatedAt,
      });
      return this;
    }
  }

  const LedgerModel = {
    findOne(query, _proj, opts = {}) {
      let boundSession = opts.session || null;
      const queryObj = {
        session(s) {
          boundSession = s;
          return this;
        },
        then(resolve, reject) {
          try {
            const acc = ledgerAccounts.get(query.accountId);
            resolve(acc ? new LedgerDocument(acc) : null);
          } catch (err) {
            reject(err);
          }
        },
      };
      return queryObj;
    },
    // Seed helper
    seed(accountId, balance, version = 0) {
      ledgerAccounts.set(accountId, { accountId, balance, version, updatedAt: new Date() });
    },
    get(accountId) {
      return ledgerAccounts.get(accountId);
    },
  };

  class TransactionDocument {
    constructor(data) {
      this._id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      this.idempotencyKey = data.idempotencyKey;
      this.orgId = data.orgId;
      this.accountId = data.accountId;
      this.amount = data.amount;
      this.currency = data.currency || 'USD';
      this.type = data.type || 'charge';
      this.status = data.status || 'pending';
      this.metadata = data.metadata || {};
      this.createdAt = data.createdAt || new Date();
    }

    toObject() {
      return { ...this };
    }

    async save(opts = {}) {
      const index = transactions.findIndex((t) => t.idempotencyKey === this.idempotencyKey);
      if (index >= 0) {
        transactions[index] = this;
      } else {
        transactions.push(this);
      }
      return this;
    }
  }

  const TransactionModel = {
    async create(docs, opts = {}) {
      const items = Array.isArray(docs) ? docs : [docs];
      const created = items.map((d) => new TransactionDocument(d));
      for (const item of created) {
        transactions.push(item);
      }
      return Array.isArray(docs) ? created : created[0];
    },

    async findOneAndUpdate(filter, update, opts = {}) {
      let doc = transactions.find((t) => t.idempotencyKey === filter.idempotencyKey);
      if (!doc && opts.upsert) {
        doc = new TransactionDocument({ ...filter, ...(update.$set || {}) });
        transactions.push(doc);
      } else if (doc && update.$set) {
        Object.assign(doc, update.$set);
      }
      return doc;
    },

    async updateOne(filter, update) {
      const doc = transactions.find((t) => t.idempotencyKey === filter.idempotencyKey);
      if (doc && update.$set) {
        Object.assign(doc, update.$set);
      }
      return { modifiedCount: doc ? 1 : 0 };
    },

    getAll() {
      return transactions;
    },
  };

  const conn = {
    name: 'tenant_org_test',
    models: {
      Ledger: LedgerModel,
      Transaction: TransactionModel,
    },
    model(name) {
      return this.models[name];
    },
    startSession: jest.fn(async () => {
      sessionCount++;
      const session = {
        id: sessionCount,
        aborted: false,
        committed: false,
        ended: false,

        async withTransaction(callback) {
          // Snapshot state for rollback simulation
          const ledgerSnapshot = new Map();
          for (const [k, v] of ledgerAccounts.entries()) {
            ledgerSnapshot.set(k, { ...v });
          }
          const txSnapshotLength = transactions.length;

          try {
            const result = await callback();
            this.committed = true;
            return result;
          } catch (err) {
            // Roll back state to snapshot (simulating MongoDB rollback)
            this.aborted = true;
            ledgerAccounts.clear();
            for (const [k, v] of ledgerSnapshot.entries()) {
              ledgerAccounts.set(k, v);
            }
            transactions.splice(txSnapshotLength);
            throw err;
          }
        },

        async endSession() {
          this.ended = true;
        },
      };

      activeSession = session;
      return session;
    }),
    getActiveSession: () => activeSession,
  };

  return { conn, LedgerModel, TransactionModel };
}

describe('processCharge in ledger.service.js', () => {
  let redis;
  let connMock;

  beforeEach(() => {
    redis = createRedisMock();
    connMock = createTenantConnectionMock();
  });

  test('successfully executes an atomic charge, decrements ledger balance, marks transaction completed, and caches in Redis', async () => {
    connMock.LedgerModel.seed('acc_primary', 10000); // 100.00 USD

    const result = await processCharge(connMock.conn, {
      accountId: 'acc_primary',
      amount: 3500, // 35.00 USD
      idempotencyKey: 'charge_success_001',
      redis,
    });

    expect(result.status).toBe('completed');
    expect(result.amount).toBe(3500);
    expect(result.balance).toBe(6500); // 10000 - 3500
    expect(result.replayed).toBe(false);

    // Verify Ledger updated
    const ledger = connMock.LedgerModel.get('acc_primary');
    expect(ledger.balance).toBe(6500);
    expect(ledger.version).toBe(1);

    // Verify Transaction document in MongoDB
    const allTx = connMock.TransactionModel.getAll();
    expect(allTx).toHaveLength(1);
    expect(allTx[0].status).toBe('completed');
    expect(allTx[0].idempotencyKey).toBe('charge_success_001');

    // Verify cached in Redis
    const cached = await redis.get('idem:org_test:charge_success_001');
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached);
    expect(parsed.status).toBe('completed');
    expect(parsed.balance).toBe(6500);

    // Verify Redis lock was released in finally block
    const lock = await redis.get('lock:org_test:charge_success_001');
    expect(lock).toBeNull();

    // Verify session was ended
    expect(connMock.conn.getActiveSession().ended).toBe(true);
  });

  test('returns cached result on idempotent duplicate request without re-executing balance decrement', async () => {
    connMock.LedgerModel.seed('acc_idem', 10000);

    const first = await processCharge(connMock.conn, {
      accountId: 'acc_idem',
      amount: 2000,
      idempotencyKey: 'charge_idem_002',
      redis,
    });
    expect(first.balance).toBe(8000);
    expect(first.replayed).toBe(false);

    // Duplicate call with same idempotency key
    const second = await processCharge(connMock.conn, {
      accountId: 'acc_idem',
      amount: 2000,
      idempotencyKey: 'charge_idem_002',
      redis,
    });

    expect(second.replayed).toBe(true);
    expect(second.status).toBe('completed');
    expect(second.transactionId).toBe(first.transactionId);

    // Ledger balance must not have been decremented a second time
    const ledger = connMock.LedgerModel.get('acc_idem');
    expect(ledger.balance).toBe(8000);
  });

  test('aborts transaction and records failed transaction outside session when funds are insufficient', async () => {
    connMock.LedgerModel.seed('acc_low_balance', 1000); // 10.00 USD

    let thrownError;
    try {
      await processCharge(connMock.conn, {
        accountId: 'acc_low_balance',
        amount: 5000, // 50.00 USD > 10.00 USD
        idempotencyKey: 'charge_insufficient_003',
        redis,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.code).toBe('INSUFFICIENT_FUNDS');
    expect(thrownError.statusCode).toBe(422);

    // Transaction aborted automatically
    const session = connMock.conn.getActiveSession();
    expect(session.aborted).toBe(true);
    expect(session.ended).toBe(true);

    // Balance remains untouched
    const ledger = connMock.LedgerModel.get('acc_low_balance');
    expect(ledger.balance).toBe(1000);

    // Failed transaction recorded outside transaction
    const allTx = connMock.TransactionModel.getAll();
    expect(allTx).toHaveLength(1);
    expect(allTx[0].status).toBe('failed');
    expect(allTx[0].idempotencyKey).toBe('charge_insufficient_003');
    expect(allTx[0].metadata.failureReason).toMatch(/Insufficient funds/);

    // Redis lock was released in finally block
    const lock = await redis.get('lock:org_test:charge_insufficient_003');
    expect(lock).toBeNull();
  });

  test('aborts transaction and records failed transaction outside session on simulated network timeout', async () => {
    connMock.LedgerModel.seed('acc_timeout', 10000);

    let thrownError;
    try {
      await processCharge(connMock.conn, {
        accountId: 'acc_timeout',
        amount: 2500,
        idempotencyKey: 'charge_timeout_004',
        simulateTimeout: true,
        redis,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.code).toBe('NETWORK_TIMEOUT');

    // Verify abort
    const session = connMock.conn.getActiveSession();
    expect(session.aborted).toBe(true);

    // Balance was rolled back
    const ledger = connMock.LedgerModel.get('acc_timeout');
    expect(ledger.balance).toBe(10000);

    // Failed transaction recorded outside transaction
    const allTx = connMock.TransactionModel.getAll();
    expect(allTx).toHaveLength(1);
    expect(allTx[0].status).toBe('failed');
    expect(allTx[0].metadata.failureReason).toBe('Simulated network timeout');

    // Redis lock was released in finally block
    const lock = await redis.get('lock:org_test:charge_timeout_004');
    expect(lock).toBeNull();
  });

  test('aborts and records failure when account is not found', async () => {
    let thrownError;
    try {
      await processCharge(connMock.conn, {
        accountId: 'acc_missing',
        amount: 1000,
        idempotencyKey: 'charge_missing_005',
        redis,
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError.statusCode).toBe(404);

    const allTx = connMock.TransactionModel.getAll();
    expect(allTx).toHaveLength(1);
    expect(allTx[0].status).toBe('failed');

    // Redis lock released
    const lock = await redis.get('lock:org_test:charge_missing_005');
    expect(lock).toBeNull();
  });

  test('rejects with 409 conflict when another request currently holds the lock', async () => {
    connMock.LedgerModel.seed('acc_conflict', 10000);

    // Pre-acquire lock for this idempotency key
    await redis.set('lock:org_test:charge_conflict_006', 'active-owner-token', 'NX', 'PX', 10000);

    await expect(
      processCharge(connMock.conn, {
        accountId: 'acc_conflict',
        amount: 1000,
        idempotencyKey: 'charge_conflict_006',
        redis,
      })
    ).rejects.toMatchObject({
      code: 'LOCK_CONFLICT',
      statusCode: 409,
    });
  });

  test('fails closed with 503 when Redis is unavailable', async () => {
    const brokenRedis = {
      get: async () => {
        throw new Error('ECONNREFUSED');
      },
      set: async () => {
        throw new Error('ECONNREFUSED');
      },
      setex: async () => {
        throw new Error('ECONNREFUSED');
      },
      eval: async () => {
        throw new Error('ECONNREFUSED');
      },
    };

    await expect(
      processCharge(connMock.conn, {
        accountId: 'acc_redis_down',
        amount: 1000,
        idempotencyKey: 'charge_redis_down_007',
        redis: brokenRedis,
      })
    ).rejects.toMatchObject({
      code: 'REDIS_DOWN',
      statusCode: 503,
    });
  });

  test('rejects missing or invalid input parameters with 400 validation error', async () => {
    await expect(
      processCharge(connMock.conn, {
        amount: 100,
        idempotencyKey: 'key_1',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      processCharge(connMock.conn, {
        accountId: 'acc_1',
        amount: 100,
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      processCharge(connMock.conn, {
        accountId: 'acc_1',
        amount: -50,
        idempotencyKey: 'key_2',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    await expect(
      processCharge(connMock.conn, {
        accountId: 'acc_1',
        amount: 12.5, // non-integer
        idempotencyKey: 'key_3',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
