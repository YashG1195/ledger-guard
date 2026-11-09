import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * TransactionSchema — core ledger entry for LedgerGuard.
 *
 * Design decisions:
 *  - `amount` stored in minor units (cents / paisa) as an integer to avoid
 *    floating-point rounding. Callers are responsible for unit conversion.
 *  - `tenantId` is denormalised here even though the document lives inside a
 *    tenant-specific database (`ledgerguard_<tenantId>`). This allows cross-
 *    shard queries and audit logs without additional joins.
 *  - `idempotencyKey` is indexed with a partial sparse index so only records
 *    that carry a key are indexed.
 */
const TransactionSchema = new Schema(
  {
    // ── Identification ──────────────────────────────────────────────────────
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

    // ── Money ───────────────────────────────────────────────────────────────
    /** Amount in minor units (e.g. 1099 = $10.99) */
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

    // ── Status ──────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'POSTED', 'REVERSED', 'FAILED'],
        message: 'Invalid status value',
      },
      default: 'PENDING',
      index: true,
    },

    // ── References ──────────────────────────────────────────────────────────
    /** External reference ID (payment gateway ref, invoice ID, etc.) */
    referenceId: {
      type: String,
      default: null,
    },

    /** Idempotency key supplied by the client — stored for audit */
    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,   // only indexes non-null values
    },

    // ── Payload ─────────────────────────────────────────────────────────────
    description: {
      type: String,
      maxlength: [500, 'description cannot exceed 500 characters'],
      default: '',
    },

    /** Arbitrary key-value pairs for caller-specific metadata */
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // ── Reversal link ───────────────────────────────────────────────────────
    /** If this transaction reverses another, store the original ID here */
    reversalOf: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },

    /** Set to true once a reversal transaction for this entry has been created */
    isReversed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,       // createdAt, updatedAt
    versionKey: false,
    collection: 'transactions',
  }
);

// ── Compound indexes ─────────────────────────────────────────────────────────
// Fast per-tenant account history queries (most common read path)
TransactionSchema.index({ tenantId: 1, accountId: 1, createdAt: -1 });

// Idempotency de-duplication check
TransactionSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'unique_tenant_idempotency' }
);

// Status-scoped reporting queries
TransactionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

// ── Virtual ──────────────────────────────────────────────────────────────────
/** Amount formatted as a decimal string for display (e.g. "10.99") */
TransactionSchema.virtual('amountDecimal').get(function () {
  return (this.amount / 100).toFixed(2);
});

export default TransactionSchema;
