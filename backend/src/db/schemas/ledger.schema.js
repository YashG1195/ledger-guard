import mongoose from 'mongoose';

const { Schema } = mongoose;

const LedgerSchema = new Schema(
  {
    accountId: {
      type: String,
      required: [true, 'accountId is required'],
      trim: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'balance must be an integer in cents',
      },
    },
    version: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'version must be an integer',
      },
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    collection: 'ledgers',
  }
);

LedgerSchema.index({ accountId: 1 }, { unique: true, name: 'unique_account' });

export default LedgerSchema;
