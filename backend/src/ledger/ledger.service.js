import { NotFoundError } from '../utils/errors.js';

/**
 * Ledger service — business logic layer.
 *
 * All methods accept (tenantId, ..., log) so they are fully testable
 * without an HTTP context. The log argument is the per-request pino
 * child logger forwarded from the controller.
 *
 * TODOs are marked where real DB / Redis wiring needs to happen.
 */

export async function createTransaction(tenantId, data, idempotencyKey, log) {
  log.info({ tenantId, idempotencyKey }, 'ledgerService.createTransaction');

  // TODO: 1. Check idempotency cache (Redis) — return cached response if hit
  // TODO: 2. Validate `data` with a Zod schema
  // TODO: 3. Acquire redlock on `tenantId:accountId` to prevent concurrent writes
  // TODO: 4. Write transaction document to mongo tenant DB (getTenantDB(tenantId))
  // TODO: 5. Store result in idempotency cache (TTL 24 h)
  // TODO: 6. Emit real-time event via Socket.io (emitToTenant)

  return { message: 'Not yet implemented — stub response', tenantId, data };
}

export async function listTransactions(tenantId, query, log) {
  log.info({ tenantId, query }, 'ledgerService.listTransactions');

  // TODO: query mongo with pagination (page, limit, cursor)
  return { items: [], total: 0, page: 1, limit: 20 };
}

export async function getTransactionById(tenantId, id, log) {
  log.info({ tenantId, id }, 'ledgerService.getTransactionById');

  // TODO: fetch from mongo tenant DB
  throw new NotFoundError(`Transaction ${id} not found`);
}
