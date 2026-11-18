import { randomUUID } from 'crypto';

// Stub implementation — will be wired to req.db / tenant mongoose connection
// in the persistence sprint. For now it validates the payload and returns a
// deterministic response shape so the idempotency layer has a real object to cache.
export async function processCharge(orgId, body, log) {
  const { amount, currency = 'USD', description = '' } = body ?? {};

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    const err = new Error('amount must be a positive number');
    err.code = 'INVALID_PAYLOAD';
    err.statusCode = 422;
    throw err;
  }

  log.info({ orgId, amount, currency }, 'processing charge');

  // Amount stored in minor units (cents / paise) to avoid floating-point drift
  return {
    transactionId: randomUUID(),
    orgId,
    amount: Math.round(amount * 100), // minor units
    currency: currency.toUpperCase(),
    description,
    status: 'completed',
    createdAt: new Date().toISOString(),
  };
}

