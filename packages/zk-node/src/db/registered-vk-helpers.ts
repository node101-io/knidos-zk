import type { zkVerifySession } from 'zkverifyjs';

import { RegisteredVk, type RegisteredVkInterface, type ZkVerifyNetwork } from './registered-vk.js';
import { computeVkHash } from '../shared/vk-hash.js';
import { UltrahonkVariant, UltrahonkVersion } from '../shared/zkverifyjs.js';

import logger from '../shared/logger.js';

export async function findOrRegisterVk(args: {
  vk: string;
  network: ZkVerifyNetwork;
  session: zkVerifySession;
}): Promise<RegisteredVkInterface> {
  const { vk, network, session } = args;
  const vkHash = computeVkHash(vk);

  const existing = await RegisteredVk.findOne({ vkHash, network });
  if (existing) return existing;

  logger.info({ vkHash, network }, '[registered-vk] registering verification key on zkverify');
  const { transactionResult } = await session
    .registerVerificationKey()
    .ultrahonk({ version: UltrahonkVersion.V0_84, variant: UltrahonkVariant.Plain })
    .execute(vk);

  const registration = await transactionResult;
  if (!registration.statementHash) {
    throw new Error('[registered-vk] zkverify did not return a statementHash after registration');
  }

  const upserted = await RegisteredVk.findOneAndUpdate(
    { vkHash, network },
    { $setOnInsert: { vkHash, vk, network, statementHash: registration.statementHash } },
    { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  if (!upserted) {
    throw new Error('[registered-vk] failed to upsert registered verification key');
  }

  logger.info(
    { vkHash, statementHash: registration.statementHash, network },
    '[registered-vk] registered and persisted verification key',
  );

  return upserted;
}
