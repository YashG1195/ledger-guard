import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.js';
import * as ledgerService from './ledger.service.js';

export const createTransaction = asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] ?? null;
  const result = await ledgerService.createTransaction(
    req.tenantId,
    req.body,
    idempotencyKey,
    req.log
  );
  sendSuccess(res, result, 201);
});

export const listTransactions = asyncHandler(async (req, res) => {
  const result = await ledgerService.listTransactions(req.tenantId, req.query, req.log);
  sendSuccess(res, result);
});

export const getTransaction = asyncHandler(async (req, res) => {
  const result = await ledgerService.getTransactionById(
    req.tenantId,
    req.params.id,
    req.log
  );
  sendSuccess(res, result);
});
