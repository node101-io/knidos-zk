import mongoose, { Schema } from 'mongoose';

export type ZkVerifyNetwork = 'volta' | 'mainnet';

export interface RegisteredVkInterface {
  vkHash: string;
  statementHash: string;
  vk: string;
  network: ZkVerifyNetwork;
  createdAt: Date;
  updatedAt: Date;
}

const RegisteredVkSchema = new Schema<RegisteredVkInterface>(
  {
    vkHash: { type: String, required: true },
    statementHash: { type: String, required: true },
    vk: { type: String, required: true },
    network: {
      type: String,
      required: true,
      enum: ['volta', 'mainnet'],
    },
  },
  { timestamps: true },
);

RegisteredVkSchema.index({ vkHash: 1, network: 1 }, { unique: true });

export const RegisteredVk =
  (mongoose.models.RegisteredVk as mongoose.Model<RegisteredVkInterface> | undefined) ??
  mongoose.model<RegisteredVkInterface>('RegisteredVk', RegisteredVkSchema);
