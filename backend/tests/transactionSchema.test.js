import mongoose from 'mongoose';
import LedgerSchema from '../src/db/schemas/ledger.schema.js';
import TransactionSchema from '../src/db/schemas/transaction.schema.js';
import UsageEventSchema from '../src/db/schemas/usageEvent.schema.js';

const isolatedMongoose = new mongoose.Mongoose();
const Transaction = isolatedMongoose.model('TransactionSchemaTest', TransactionSchema);
const Ledger = isolatedMongoose.model('LedgerSchemaTest', LedgerSchema);
const UsageEvent = isolatedMongoose.model('UsageEventSchemaTest', UsageEventSchema);

describe('Transaction schema', () => {
  it('accepts a transaction with the requested fields', async () => {
    const transaction = new Transaction({
      idempotencyKey: 'request-1',
      orgId: 'org-1',
      amount: 1250,
      currency: 'usd',
      type: 'charge',
    });

    await expect(transaction.validate()).resolves.toBeUndefined();
    expect(transaction.currency).toBe('USD');
    expect(transaction.status).toBe('pending');
    expect(transaction.createdAt).toBeInstanceOf(Date);
  });

  it('requires an idempotency key and rejects non-integer amounts and invalid enums', async () => {
    const transaction = new Transaction({
      orgId: 'org-1',
      amount: 12.5,
      type: 'debit',
      status: 'posted',
    });

    await expect(transaction.validate()).rejects.toMatchObject({
      errors: {
        idempotencyKey: expect.any(Object),
        amount: expect.any(Object),
        type: expect.any(Object),
        status: expect.any(Object),
      },
    });
  });

  it('uses a unique index on the idempotency key', () => {
    expect(TransactionSchema.indexes()).toContainEqual([
      { idempotencyKey: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});

describe('Ledger schema', () => {
  it('validates integer-cent balances and provides the requested defaults', async () => {
    const ledger = new Ledger({ accountId: 'account-1' });

    await expect(ledger.validate()).resolves.toBeUndefined();
    expect(ledger.balance).toBe(0);
    expect(ledger.version).toBe(0);
    expect(ledger.updatedAt).toBeInstanceOf(Date);
    await expect(new Ledger({ accountId: 'account-2', balance: 12.5 }).validate()).rejects.toHaveProperty(
      'errors.balance'
    );
  });

  it('uses a unique index on accountId', () => {
    expect(LedgerSchema.indexes()).toContainEqual([
      { accountId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});

describe('UsageEvent schema', () => {
  it('accepts the requested fields and defaults the timestamp', async () => {
    const event = new UsageEvent({
      resource: 'api_calls',
      cost: 0.25,
      orgId: 'org-1',
    });

    await expect(event.validate()).resolves.toBeUndefined();
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('indexes timestamp in descending order', () => {
    expect(UsageEventSchema.indexes()).toContainEqual([{ timestamp: -1 }, expect.any(Object)]);
  });
});
