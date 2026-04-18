import mongoose, { Schema } from 'mongoose';
import type { zkVerifySession } from 'zkverifyjs';

import logger from '../shared/logger.js';
import { computeVkHash } from '../shared/vk-hash.js';

export type ZkVerifyNetwork = 'volta' | 'mainnet';

export interface RegisteredVkInterface {
  vkHash: string;
  statementHash: string;
  vk: string;
  network: ZkVerifyNetwork;
  createdAt: Date;
  updatedAt: Date;
}

interface RegisteredVkModelType extends mongoose.Model<RegisteredVkInterface> {
  findOrRegister(args: {
    vk: string;
    network: ZkVerifyNetwork;
    session: zkVerifySession;
  }): Promise<RegisteredVkInterface>;
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

RegisteredVkSchema.statics.findOrRegister = async function (args: {
  vk: string;
  network: ZkVerifyNetwork;
  session: zkVerifySession;
}): Promise<RegisteredVkInterface> {
  const { vk, network, session } = args;
  const vkHash = computeVkHash(vk);

  const existing = await this.findOne({ vkHash, network });
  if (existing) return existing;

  logger.info({ vkHash, network }, '[registered-vk] registering verification key on zkverify');
  const { transactionResult } = await session
    .registerVerificationKey()
    .ultrahonk()
    .execute(vk);

  const registration = await transactionResult;
  if (!registration.statementHash) {
    throw new Error('[registered-vk] zkverify did not return a statementHash after registration');
  }

  const upserted = await this.findOneAndUpdate(
    { vkHash, network },
    { $setOnInsert: { vkHash, vk, network, statementHash: registration.statementHash } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  logger.info(
    { vkHash, statementHash: registration.statementHash, network },
    '[registered-vk] registered and persisted verification key',
  );

  return upserted;
};

const RegisteredVk = mongoose.model<RegisteredVkInterface, RegisteredVkModelType>(
  'RegisteredVk',
  RegisteredVkSchema,
);

export default RegisteredVk;
