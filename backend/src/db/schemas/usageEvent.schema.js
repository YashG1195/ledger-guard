import mongoose from 'mongoose';

const { Schema } = mongoose;

const UsageEventSchema = new Schema(
  {
    resource: {
      type: String,
      required: [true, 'resource is required'],
      trim: true,
    },
    cost: {
      type: Number,
      required: [true, 'cost is required'],
      min: [0, 'cost cannot be negative'],
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    orgId: {
      type: String,
      required: [true, 'orgId is required'],
      index: true,
    },
  },
  {
    versionKey: false,
    collection: 'usage_events',
  }
);

UsageEventSchema.index({ timestamp: -1 });
UsageEventSchema.index({ orgId: 1, timestamp: -1 });
UsageEventSchema.index({ orgId: 1, resource: 1, timestamp: -1 });

export default UsageEventSchema;
