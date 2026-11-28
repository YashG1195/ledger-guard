import LedgerSchema from './ledger.schema.js';
import TransactionSchema from './transaction.schema.js';
import UsageEventSchema from './usageEvent.schema.js';
import TenantSettingsSchema from './tenantSettings.schema.js';

export const tenantSchemas = {
  Ledger: LedgerSchema,
  Transaction: TransactionSchema,
  UsageEvent: UsageEventSchema,
  TenantSettings: TenantSettingsSchema,
};

export {
  LedgerSchema,
  TransactionSchema,
  UsageEventSchema,
  TenantSettingsSchema,
};

