import mongoose from 'mongoose';

const { Schema } = mongoose;

const UsageEventSchema = new Schema(
  {
    orgId: {
      type: String,
      required: [true, 'orgId is required'],
      index: true,
    },
    customerId: {
      type: String,
      required: [true, 'customerId is required'],
      index: true,
    },
    eventName: {
      type: String,
      required: [true, 'eventName is required'],
      index: true,
    },
    quantity: {
      type: Number,
      required: [true, 'quantity is required'],
      min: [0, 'quantity cannot be negative'],
    },
    unit: {
      type: String,
      default: 'units',
    },
    idempotencyKey: {
      type: String,
      default: null,
      sparse: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    processed: {
      type: Boolean,
      default: false,
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
    collection: 'usage_events',
  }
);

UsageEventSchema.index(
  { orgId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'unique_org_usage_idempotency' }
);
UsageEventSchema.index({ orgId: 1, eventName: 1, timestamp: -1 });

export default UsageEventSchema;

