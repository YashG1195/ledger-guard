import mongoose from 'mongoose';

const { Schema } = mongoose;

const TransactionSchema = new Schema(
  {
    tenantId: {
      type: String,
      required: [true, 'tenantId is required'],
      index: true,
    },

    accountId: {
      type: String,
      required: [true, 'accountId is required'],
      index: true,
    },

    // store in minor currency units (e.g. cents) to prevent float math rounding issues
    amount: {
      type: Number,
      required: [true, 'amount is required'],
      min: [1, 'amount must be at least 1 minor unit'],
      validate: {
        validator: Number.isInteger,
        message: 'amount must be an integer (minor units)',
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
        values: ['CREDIT', 'DEBIT'],
        message: 'type must be CREDIT or DEBIT',
      },
      required: [true, 'type is required'],
    },

    status: {
      type: String,
      enum: {
        values: ['PENDING', 'POSTED', 'REVERSED', 'FAILED'],
        message: 'invalid status value',
      },
      default: 'PENDING',
      index: true,
    },

    referenceId: {
      type: String,
      default: null,
    },

    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,
    },

    description: {
      type: String,
      maxlength: [500, 'description cannot exceed 500 characters'],
      default: '',
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    reversalOf: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },

    isReversed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'transactions',
  }
);

TransactionSchema.index({ tenantId: 1, accountId: 1, createdAt: -1 });
TransactionSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'unique_tenant_idempotency' }
);
TransactionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

TransactionSchema.virtual('amountDecimal').get(function () {
  return (this.amount / 100).toFixed(2);
});

export default TransactionSchema;
