import * as zkv from 'zkverifyjs';

const { zkVerifySession, UltrahonkVariant } = zkv;
type UltrahonkVariant = zkv.UltrahonkVariant;
type VerifyTransactionInfo = zkv.VerifyTransactionInfo;

import RegisteredVk from '../../db/registered-vk.js';
import { env } from '../../env.js';

// Singleton — reuse across jobs (same as Primus pattern in zk-tls)
let sessionInstance: zkv.zkVerifySession | null = null;

async function getSession(): Promise<zkv.zkVerifySession> {
  if (sessionInstance) return sessionInstance;
  const builder = zkVerifySession.start();
  const networked =
    env.ZKVERIFY_NETWORK === 'mainnet' ? builder.zkVerify() : builder.Volta();
  sessionInstance = await networked.withAccount(env.ZKVERIFY_SEED_PHRASE);
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

  const registered = await RegisteredVk.findOrRegister({
    vk,
    network: env.ZKVERIFY_NETWORK,
    session,
  });

  const { transactionResult } = await session
    .verify()
    .ultrahonk({ variant })
    .withRegisteredVk()
    .execute({
      proofData: { vk: registered.statementHash, proof, publicSignals },
      ...(env.ZKVERIFY_DOMAIN_ID !== undefined ? { domainId: env.ZKVERIFY_DOMAIN_ID } : {}),
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
