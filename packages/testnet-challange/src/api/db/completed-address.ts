import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

import { PASS_THRESHOLD, RECORD_COUNT } from '../../types.js';

const completedAddressSchema = new Schema(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^0x[0-9a-f]{40}$/,
    },
    // The user's best score on this address. We only persist passing scores
    // (>= PASS_THRESHOLD), and update via $max so subsequent runs can raise
    // but never lower it. Documents created before this field existed read
    // back as undefined; the API surface coerces missing → RECORD_COUNT
    // (those addresses passed when the threshold was a perfect run).
    score: {
      type: Number,
      min: PASS_THRESHOLD,
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
