import mongoose from 'mongoose';

const { Schema } = mongoose;

const LedgerSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'ledger name is required'],
      trim: true,
    },
    orgId: {
      type: String,
      required: [true, 'orgId is required'],
      index: true,
    },
    currency: {
      type: String,
      required: [true, 'currency is required'],
      uppercase: true,
      default: 'USD',
    },
    balance: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'balance must be in minor currency units',
      },
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'LOCKED', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'ledgers',
  }
);

LedgerSchema.index({ orgId: 1, name: 1 }, { unique: true });

export default LedgerSchema;

