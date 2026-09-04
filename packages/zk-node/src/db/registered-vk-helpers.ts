import type { zkVerifySession } from 'zkverifyjs';

import { RegisteredVk, type RegisteredVkInterface, type ZkVerifyNetwork } from './registered-vk.js';
import { computeStatementHash, computeVkHash } from '../shared/vk-hash.js';
import { UltrahonkVariant } from '../shared/zkverifyjs.js';

import logger from '../shared/logger.js';

// zkverifyjs decodes the pallet's VerificationKeyAlreadyRegistered dispatch
// error into a plain Error carrying only the pallet doc string; the error code
// itself is not exposed, so the message is the only handle we have. If the
// wording ever changes the fallback simply stops matching and the task fails
// visibly - it cannot fail silently.
const ALREADY_REGISTERED_PATTERN = /already been registered/i;

function isAlreadyRegisteredError(error: unknown): boolean {
  return error instanceof Error && ALREADY_REGISTERED_PATTERN.test(error.message);
}

type RegistrationOutcome = { statementHash: string; source: 'chain' | 'derived' };

// Registers the VK on zkVerify. A VK can only be registered once per chain,
// and the Mongo row that remembers it can be missing - a fresh database, or a
// key registered by a one-off script against another database - so "already
// registered" is treated as success and the statement hash is derived locally
// instead of read from the (absent) registration event.
async function registerOnChain(
  vk: string,
  network: ZkVerifyNetwork,
  session: zkVerifySession,
): Promise<RegistrationOutcome> {
  const vkHash = computeVkHash(vk);

  logger.info({ vkHash, network }, '[registered-vk] registering verification key on zkverify');
  try {
    const { transactionResult } = await session
      .registerVerificationKey()
      .ultrahonk({ variant: UltrahonkVariant.Plain })
      .execute(vk);
    const { statementHash } = await transactionResult;
    if (!statementHash) {
      throw new Error('[registered-vk] zkverify did not return a statementHash after registration');
    }
    return { statementHash, source: 'chain' };
  } catch (error) {
    if (!isAlreadyRegisteredError(error)) throw error;

    const statementHash = computeStatementHash(vk);
    logger.warn(
      { vkHash, statementHash, network },
      '[registered-vk] verification key already registered on zkverify, adopting it',
    );
    return { statementHash, source: 'derived' };
  }
}

async function persistRegisteredVk(
  vk: string,
  network: ZkVerifyNetwork,
  statementHash: string,
): Promise<RegisteredVkInterface> {
  const vkHash = computeVkHash(vk);
  const upserted = await RegisteredVk.findOneAndUpdate(
    { vkHash, network },
    { $setOnInsert: { vkHash, vk, network, statementHash } },
    { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  if (!upserted) {
    throw new Error('[registered-vk] failed to upsert registered verification key');
  }

  return upserted;
}

export async function findOrRegisterVk(args: {
  vk: string;
  network: ZkVerifyNetwork;
  session: zkVerifySession;
}): Promise<RegisteredVkInterface> {
  const { vk, network, session } = args;
  const vkHash = computeVkHash(vk);

  const existing = await RegisteredVk.findOne({ vkHash, network });
  if (existing) return existing;

  const { statementHash, source } = await registerOnChain(vk, network, session);
  // The chain's answer is authoritative and is persisted before anything else,
  // so later runs find it in Mongo and never depend on the derived formula.
  const registered = await persistRegisteredVk(vk, network, statementHash);

  // The derived formula is what the already-registered path relies on. Check
  // it against every fresh registration so a drift fails loudly once, here,
  // instead of surfacing as a wrong statement hash on some future fresh
  // database. The row is already persisted, so the retry succeeds.
  const derivedStatementHash = computeStatementHash(vk);
  if (source === 'chain' && statementHash !== derivedStatementHash) {
    throw new Error(
      `[registered-vk] statementHash formula drift: zkverify returned ${statementHash}, computeStatementHash gives ${derivedStatementHash}; fix computeStatementHash before relying on the already-registered fallback`,
    );
  }

  logger.info(
    { vkHash, statementHash, network, source },
    '[registered-vk] registered and persisted verification key',
  );

  return registered;
}
