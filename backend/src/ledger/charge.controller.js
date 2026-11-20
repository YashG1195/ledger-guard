import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getRedis } from '../config/redis.js';
import { withIdempotency } from './idempotency.js';
import * as chargeService from './charge.service.js';
import * as ledgerService from './ledger.service.js';
import { emitTransactionUpdate } from '../realtime/socketHandler.js';

// POST /ledger/charge (or /api/v1/ledger/charge)
// Requires: Idempotency-Key header, auth + tenant middleware upstream
// Dev-only header: X-Simulate-Failure: timeout (triggers transaction rollback demonstration)
export const charge = asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey || !idempotencyKey.trim()) {
    return res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'The Idempotency-Key header is required for charge requests',
      },
    });
  }

  const { orgId } = req.tenant;
  const redis = getRedis();
  const cleanKey = idempotencyKey.trim();

  // Dev-only header for demonstrating rollback behavior
  const simulateFailure = req.headers['x-simulate-failure'];
  const simulateTimeout =
    process.env.NODE_ENV !== 'production' &&
    typeof simulateFailure === 'string' &&
    simulateFailure.toLowerCase() === 'timeout';

  // If running against real tenant DB with session support, use transactional processCharge
  if (req.db && typeof req.db.startSession === 'function') {
    const rawAmount = req.body?.amount;
    const amount =
      typeof rawAmount === 'number'
        ? Number.isInteger(rawAmount)
          ? rawAmount
          : Math.round(rawAmount * 100)
        : rawAmount;

    const accountId = req.body?.accountId || `acc_${orgId}`;

    const result = await ledgerService.processCharge(req.db, {
      accountId,
      amount,
      idempotencyKey: cleanKey,
      currency: req.body?.currency || 'USD',
      orgId,
      metadata: req.body?.metadata || {},
      simulateTimeout,
    });

    res.set('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    return sendSuccess(res, result, result.replayed ? 200 : 201);
  }

  // Fallback for mocked DB contexts
  const { result, replayed } = await withIdempotency(
    redis,
    orgId,
    cleanKey,
    30_000,
    async () => {
      if (simulateTimeout) {
        emitTransactionUpdate(orgId, {
          transactionId: cleanKey,
          status: 'failed',
        });
        const err = new Error('Simulated network timeout');
        err.code = 'NETWORK_TIMEOUT';
        throw err;
      }

      const res = await chargeService.processCharge(orgId, req.body, req.log);
      emitTransactionUpdate(orgId, {
        transactionId: res.transactionId,
        status: res.status || 'completed',
      });
      return res;
    }
  );

  res.set('Idempotency-Replayed', replayed ? 'true' : 'false');
  sendSuccess(res, result, replayed ? 200 : 201);
});
