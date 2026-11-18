import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import { getRedis } from '../config/redis.js';
import { withIdempotency } from './idempotency.js';
import * as chargeService from './charge.service.js';

// POST /ledger/charge
// Requires: Idempotency-Key header, auth + tenant middleware upstream
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

  const { result, replayed } = await withIdempotency(
    redis,
    orgId,
    idempotencyKey.trim(),
    30_000, // lock TTL: 30 seconds
    () => chargeService.processCharge(orgId, req.body, req.log),
  );

  res.set('Idempotency-Replayed', replayed ? 'true' : 'false');
  sendSuccess(res, result, replayed ? 200 : 201);
});

