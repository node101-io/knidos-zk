import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

import { RECORD_COUNT, RECORD_THRESHOLD } from '../../types.js';

const completedAddressSchema = new Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^0x[0-9a-f]{40}$/,
    },
    // The user's best score on this address. We persist any result with at
    // least one correct answer (>= RECORD_THRESHOLD) and update via $max so
    // subsequent runs can raise but never lower it. Documents created before
    // this field existed read back as undefined; the API surface coerces
    // missing → RECORD_COUNT (those addresses were stored under the old
    // perfect-run rule).
    score: {
      type: Number,
      min: RECORD_THRESHOLD,
      max: RECORD_COUNT,
    },
  },
  { collection: 'completed_addresses', versionKey: false, timestamps: true },
);

completedAddressSchema.index({ score: -1, _id: -1 });

export type CompletedAddressInterface = InferSchemaType<typeof completedAddressSchema>;

// `mongoose.models.X ?? mongoose.model(...)` survives HMR re-evaluation —
// otherwise Mongoose throws OverwriteModelError on second module load.
export const CompletedAddress: Model<CompletedAddressInterface> =
  (mongoose.models.CompletedAddress as Model<CompletedAddressInterface>) ??
  mongoose.model<CompletedAddressInterface>('CompletedAddress', completedAddressSchema);
