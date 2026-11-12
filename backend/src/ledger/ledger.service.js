import { NotFoundError } from '../utils/errors.js';

export async function createTransaction(tenantId, data, idempotencyKey, log) {
  log.info({ tenantId, idempotencyKey }, 'creating transaction');

  // will connect idempotency check, account lock, and mongoose persistence
  return {
    status: 'pending',
    tenantId,
    data,
  };
}

export async function listTransactions(tenantId, query, log) {
  log.info({ tenantId, query }, 'listing transactions');

  return {
    items: [],
    total: 0,
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 20,
  };
}

export async function getTransactionById(tenantId, id, log) {
  log.info({ tenantId, id }, 'fetching transaction by id');

  throw new NotFoundError(`Transaction ${id} not found`);
}
