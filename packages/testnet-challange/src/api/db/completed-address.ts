import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const completedAddressSchema = new Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^0x[0-9a-f]{40}$/,
    },
  },
  { collection: 'completed_addresses', versionKey: false, timestamps: true },
);

export type CompletedAddressInterface = InferSchemaType<typeof completedAddressSchema>;

// `mongoose.models.X ?? mongoose.model(...)` survives HMR re-evaluation —
// otherwise Mongoose throws OverwriteModelError on second module load.
export const CompletedAddress: Model<CompletedAddressInterface> =
  (mongoose.models.CompletedAddress as Model<CompletedAddressInterface>) ??
  mongoose.model<CompletedAddressInterface>('CompletedAddress', completedAddressSchema);
