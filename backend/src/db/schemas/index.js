import LedgerSchema from './ledger.schema.js';
import TransactionSchema from './transaction.schema.js';
import UsageEventSchema from './usageEvent.schema.js';

export const tenantSchemas = {
  Ledger: LedgerSchema,
  Transaction: TransactionSchema,
  UsageEvent: UsageEventSchema,
};

export { LedgerSchema, TransactionSchema, UsageEventSchema };

