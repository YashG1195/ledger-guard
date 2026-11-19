import { getRedis } from '../config/redis.js';
import {
  acquireLock,
  releaseLock,
  checkIdempotency,
  storeIdempotency,
} from './idempotency.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { TransactionSchema, LedgerSchema } from '../db/schemas/index.js';

/**
 * Executes an atomic charge on a tenant ledger account protected by idempotency and distributed locking.
 *
 * Flow:
 * 1. Checks cache and acquires Redis distributed lock for this idempotencyKey.
 * 2. Starts a MongoDB session on the tenant connection: session.withTransaction().
 * 3. Inside transaction: inserts Transaction ('pending'), decrements Ledger balance
 *    (fails on insufficient funds), and transitions Transaction to 'completed'.
 * 4. On any thrown error (or simulated network timeout), transaction aborts automatically,
 *    Transaction document is recorded as 'failed' outside the transaction, and the Redis lock
 *    is released in a finally block.
 * 5. Caches the successful outcome in Redis for subsequent idempotent replays.
 */
export async function processCharge(conn, params = {}) {
  const {
    accountId,
    amount,
    idempotencyKey,
    currency = 'USD',
    orgId: passedOrgId,
    metadata = {},
    redis: passedRedis,
    simulateTimeout = false,
    lockTtlMs = 30000,
  } = params;

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    const err = new ValidationError('idempotencyKey is required');
    err.statusCode = 400;
    throw err;
  }

  if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
    const err = new ValidationError('accountId is required');
    err.statusCode = 400;
    throw err;
  }

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    const err = new ValidationError('amount must be a positive integer in minor units');
    err.statusCode = 400;
    throw err;
  }

  const cleanIdempotencyKey = idempotencyKey.trim();
  const cleanAccountId = accountId.trim();
  const orgId =
    passedOrgId || (conn?.name ? conn.name.replace(/^tenant_/, '') : null) || 'default';
  const redis = passedRedis || getRedis();

  // Return prior cached response immediately if present
  let cached;
  try {
    cached = await checkIdempotency(redis, orgId, cleanIdempotencyKey);
  } catch (err) {
    logger.error({ err, orgId, idempotencyKey: cleanIdempotencyKey }, 'redis unavailable during cache check');
    const redisDownError = new Error('Redis unavailable — cannot safely process payment');
    redisDownError.code = 'REDIS_DOWN';
    redisDownError.statusCode = 503;
    throw redisDownError;
  }

  if (cached) {
    logger.info({ orgId, idempotencyKey: cleanIdempotencyKey }, 'idempotency cache hit');
    return { ...cached, replayed: true };
  }

  // 1. Acquire Redis lock
  let token;
  try {
    token = await acquireLock(redis, orgId, cleanIdempotencyKey, lockTtlMs);
  } catch (err) {
    logger.error({ err, orgId, idempotencyKey: cleanIdempotencyKey }, 'redis unavailable during lock acquire');
    const redisDownError = new Error('Redis unavailable — cannot safely process payment');
    redisDownError.code = 'REDIS_DOWN';
    redisDownError.statusCode = 503;
    throw redisDownError;
  }

  if (!token) {
    const raceResult = await checkIdempotency(redis, orgId, cleanIdempotencyKey).catch(() => null);
    if (raceResult) {
      return { ...raceResult, replayed: true };
    }
    const conflictErr = new Error('Concurrent charge in progress for this idempotency key');
    conflictErr.code = 'LOCK_CONFLICT';
    conflictErr.statusCode = 409;
    throw conflictErr;
  }

  const Transaction = conn.models?.Transaction || conn.model('Transaction', TransactionSchema);
  const Ledger = conn.models?.Ledger || conn.model('Ledger', LedgerSchema);

  let finalResult = null;

  try {
    // 2. Start a MongoDB session on the tenant connection
    const session = await conn.startSession();

    try {
      await session.withTransaction(async () => {
        // 3. Inside transaction: insert Transaction document ('pending')
        const [txDoc] = await Transaction.create(
          [
            {
              idempotencyKey: cleanIdempotencyKey,
              orgId,
              accountId: cleanAccountId,
              amount,
              currency: currency.toUpperCase(),
              type: 'charge',
              status: 'pending',
              metadata,
            },
          ],
          { session }
        );

        if (simulateTimeout) {
          const timeoutErr = new Error('Simulated network timeout');
          timeoutErr.code = 'NETWORK_TIMEOUT';
          throw timeoutErr;
        }

        // Decrement/update the Ledger balance (reject if insufficient funds)
        let ledgerQuery = Ledger.findOne({ accountId: cleanAccountId }, null, { session });
        if (ledgerQuery && typeof ledgerQuery.session === 'function') {
          ledgerQuery = ledgerQuery.session(session);
        }
        const ledger = await ledgerQuery;
        if (!ledger) {
          const notFoundErr = new NotFoundError(`Account ${cleanAccountId} not found`);
          notFoundErr.code = 'ACCOUNT_NOT_FOUND';
          notFoundErr.statusCode = 404;
          throw notFoundErr;
        }

        if (ledger.balance < amount) {
          const fundsErr = new Error(
            `Insufficient funds: account balance ${ledger.balance} is less than charge amount ${amount}`
          );
          fundsErr.code = 'INSUFFICIENT_FUNDS';
          fundsErr.statusCode = 422;
          throw fundsErr;
        }

        ledger.balance -= amount;
        ledger.version += 1;
        ledger.updatedAt = new Date();
        await ledger.save({ session });

        // Mark Transaction as 'completed'
        txDoc.status = 'completed';
        await txDoc.save({ session });

        finalResult = {
          transactionId: txDoc._id ? txDoc._id.toString() : txDoc.id,
          idempotencyKey: cleanIdempotencyKey,
          orgId,
          accountId: cleanAccountId,
          amount,
          currency: txDoc.currency,
          status: 'completed',
          balance: ledger.balance,
          createdAt: txDoc.createdAt,
          replayed: false,
        };
      });
    } catch (txErr) {
      // 4. Transaction aborted automatically. Record Transaction as 'failed' OUTSIDE the transaction.
      try {
        await Transaction.create([
          {
            idempotencyKey: cleanIdempotencyKey,
            orgId,
            accountId: cleanAccountId,
            amount,
            currency: currency.toUpperCase(),
            type: 'charge',
            status: 'failed',
            metadata: {
              ...metadata,
              failureReason: txErr.message,
              errorCode: txErr.code || 'TRANSACTION_FAILED',
            },
          },
        ]);
      } catch (recordErr) {
        // Fallback update if a document already exists under this idempotencyKey
        await Transaction.updateOne(
          { idempotencyKey: cleanIdempotencyKey },
          {
            $set: {
              status: 'failed',
              'metadata.failureReason': txErr.message,
              'metadata.errorCode': txErr.code || 'TRANSACTION_FAILED',
            },
          }
        ).catch(() => {});
      }

      throw txErr;
    } finally {
      await session.endSession();
    }

    // 5. Cache final result in Redis for idempotent replays
    if (finalResult) {
      await storeIdempotency(redis, orgId, cleanIdempotencyKey, finalResult);
    }

    return finalResult;
  } finally {
    // Release Redis lock in finally block
    await releaseLock(redis, orgId, cleanIdempotencyKey, token).catch((err) => {
      logger.warn({ err, orgId, idempotencyKey: cleanIdempotencyKey }, 'failed to release redis lock');
    });
  }
}

export async function createTransaction(tenantId, data, idempotencyKey, log) {
  log?.info({ tenantId, idempotencyKey }, 'creating transaction');
  return {
    status: 'pending',
    tenantId,
    data,
  };
}

export async function listTransactions(tenantId, query, log) {
  log?.info({ tenantId, query }, 'listing transactions');
  return {
    items: [],
    total: 0,
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 20,
  };
}

export async function getTransactionById(tenantId, id, log) {
  log?.info({ tenantId, id }, 'fetching transaction by id');
  throw new NotFoundError(`Transaction ${id} not found`);
}
