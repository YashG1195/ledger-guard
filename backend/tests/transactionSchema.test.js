import mongoose from 'mongoose';
import TransactionSchema from '../src/db/schemas/transaction.schema.js';

const isolatedMongoose = new mongoose.Mongoose();
const Transaction = isolatedMongoose.model('TransactionSchemaTest', TransactionSchema);

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
});
