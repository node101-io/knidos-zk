import * as zkv from 'zkverifyjs';

const { zkVerifySession, UltrahonkVariant } = zkv;
type UltrahonkVariant = zkv.UltrahonkVariant;
type VerifyTransactionInfo = zkv.VerifyTransactionInfo;

import { env } from '../../env.js';

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

  const session = await zkVerifySession.start().Volta().withAccount(env.ZKVERIFY_SEED_PHRASE);
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
