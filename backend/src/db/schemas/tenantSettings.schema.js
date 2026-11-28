import mongoose from 'mongoose';

const { Schema } = mongoose;

const TenantSettingsSchema = new Schema(
  {
    orgId: {
      type: String,
      required: [true, 'orgId is required'],
      unique: true,
      index: true,
    },
    monthlyLimit: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'monthlyLimit cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'monthlyLimit must be an integer in cents to avoid floating-point drift',
      },
    },
  },
  {
    versionKey: false,
    collection: 'tenant_settings',
    timestamps: true,
  }
);

export default TenantSettingsSchema;
