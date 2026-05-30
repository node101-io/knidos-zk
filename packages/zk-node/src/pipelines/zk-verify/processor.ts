import * as zkv from 'zkverifyjs';

const { zkVerifySession, UltrahonkVariant, UltrahonkVersion } = zkv;
type UltrahonkVariant = zkv.UltrahonkVariant;
type VerifyTransactionInfo = zkv.VerifyTransactionInfo;

import { findOrRegisterVk } from '../../db/registered-vk-helpers.js';
import { env } from '../../env.js';
import logger from '../../shared/logger.js';

const VERIFY_TIMEOUT_MS = 60 * 1000;

let sessionPromise: Promise<zkv.zkVerifySession> | null = null;

// Owner identity prevents a late 'disconnected' handler from an old WS
// from clearing a replacement session that already swapped in.
async function invalidate(owner: Promise<zkv.zkVerifySession>): Promise<void> {
  if (sessionPromise !== owner) return;
  sessionPromise = null;
  try {
    await (await owner).close();
  } catch (error) {
    logger.warn({ error }, '[zkVerify processor] failed to close stale session');
  }
}

async function getSession(): Promise<zkv.zkVerifySession> {
  if (sessionPromise) {
    try {
      const session = await sessionPromise;
      if (session.provider.isConnected) return session;
      await invalidate(sessionPromise);
    } catch {
      sessionPromise = null;
    }
  }

  const pending = (async () => {
    const builder = zkVerifySession.start();
    const networked = env.ZKVERIFY_NETWORK === 'mainnet' ? builder.zkVerify() : builder.Volta();
    return networked.withAccount(env.ZKVERIFY_SEED_PHRASE);
  })();
  sessionPromise = pending;

  try {
    const session = await pending;
    session.provider.on('disconnected', () => {
      logger.warn('[zkVerify processor] provider disconnected, invalidating session');
      void invalidate(pending);
    });
    return session;
  } catch (error) {
    if (sessionPromise === pending) sessionPromise = null;
    throw error;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface ZkVerifyProcessorInput {
  vk: string;
  proof: string;
  publicSignals: string[];
}

export interface ZkVerifyProcessorResult {
  variant: UltrahonkVariant;
  vk: string;
  proof: string;
  publicSignals: string[];
  includedInBlock?: VerifyTransactionInfo;
  statement?: string;
  aggregationId?: number;
}

export async function runZkVerifyProcessor(
  input: ZkVerifyProcessorInput,
): Promise<ZkVerifyProcessorResult> {
  const variant = UltrahonkVariant.Plain;
  // Proofs are produced by Barretenberg 0.84.0 (see Dockerfile / scripts/verify-vk.sh).
  // Runtime rt-zkverify-1.6.2 replaced the old `Plain` proof enum with versioned
  // variants (V0_84 / V3_0 / Legacy), so the version must be declared explicitly.
  const version = UltrahonkVersion.V0_84;
  const { vk, proof, publicSignals } = input;

  const session = await getSession();
  const owner = sessionPromise;

  const registered = await findOrRegisterVk({
    vk,
    network: env.ZKVERIFY_NETWORK,
    session,
  });

  const { transactionResult } = await session
    .verify()
    .ultrahonk({ version, variant })
    .withRegisteredVk()
    .execute({
      proofData: { vk: registered.statementHash, proof, publicSignals },
      ...(env.ZKVERIFY_DOMAIN_ID !== undefined ? { domainId: env.ZKVERIFY_DOMAIN_ID } : {}),
    });

  let transactionInfo: VerifyTransactionInfo;
  try {
    transactionInfo = await withTimeout(
      transactionResult,
      VERIFY_TIMEOUT_MS,
      '[zkVerify processor] transactionResult',
    );
  } catch (error) {
    if (owner) await invalidate(owner);
    throw error;
  }

  const statement = transactionInfo.statement ?? undefined;
  const aggregationId = transactionInfo.aggregationId ?? undefined;

  return {
    variant,
    vk,
    proof,
    publicSignals,
    includedInBlock: transactionInfo,
    ...(statement !== undefined ? { statement } : {}),
    ...(aggregationId !== undefined ? { aggregationId } : {}),
  };
}
