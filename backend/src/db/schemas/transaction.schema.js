import mongoose from 'mongoose';

const { Schema } = mongoose;

const TransactionSchema = new Schema(
  {
    idempotencyKey: {
      type: String,
      required: [true, 'idempotencyKey is required'],
      trim: true,
    },
    orgId: {
      type: String,
      required: [true, 'orgId is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'amount is required'],
      validate: {
        validator: Number.isInteger,
        message: 'amount must be an integer in minor currency units',
      },
    },
    currency: {
      type: String,
      required: [true, 'currency is required'],
      uppercase: true,
      match: [/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'],
      default: 'USD',
    },
    type: {
      type: String,
      enum: {
        values: ['charge', 'refund'],
        message: 'type must be charge or refund',
      },
      required: [true, 'type is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'completed', 'failed', 'rolled_back'],
        message: 'invalid status value',
      },
      default: 'pending',
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    collection: 'transactions',
  }
);

TransactionSchema.index(
  { orgId: 1, idempotencyKey: 1 },
  { unique: true, name: 'unique_org_idempotency' }
);
TransactionSchema.index({ orgId: 1, status: 1, createdAt: -1 });

export default TransactionSchema;
