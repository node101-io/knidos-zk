import * as zkv from 'zkverifyjs';

const { zkVerifySession, UltrahonkVariant } = zkv;
type UltrahonkVariant = zkv.UltrahonkVariant;
type VerifyTransactionInfo = zkv.VerifyTransactionInfo;

import { env } from '../../env.js';

// Singleton — reuse across jobs (same as Primus pattern in zk-tls)
let sessionInstance: zkv.zkVerifySession | null = null;

async function getSession(): Promise<zkv.zkVerifySession> {
  if (sessionInstance) return sessionInstance;
  sessionInstance = await zkVerifySession.start().Volta().withAccount(env.ZKVERIFY_SEED_PHRASE);
  return sessionInstance;
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

  const { vk, proof, publicSignals } = input;

  const session = await getSession();
  const { transactionResult } = await session.verify().ultrahonk({ variant }).execute({
    proofData: { vk, proof, publicSignals },
    domainId: 0,
  });

  const transactionInfo = await transactionResult;
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
