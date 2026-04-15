import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { ethers } from 'ethers';

import Task from '../../db/task.js';
import { env } from '../../env.js';
import { fetchRawFills } from '../../utils/fetch-raw-fills.js';
import { bytes32ToField2DecStrings } from '../../utils/bytes32-to-field2-dec-strings.js';
import { hexToFixedBytes } from '../../utils/hex-to-fixed-bytes.js';
import { padRawFills } from '../../utils/pad-raw-fills.js';
import {
  primusAttest,
  primusSubmit,
  primusVerify,
  TASK_TIMEOUT_MS,
  type PrimusCheckpoint,
} from '../../zk-tls/attest-hyperliquid.js';
import { getFillsCommitment } from '../../zk-tls/get-fills-commitment.js';
import type { VerifiedHyperliquidAttestation } from '../../zk-tls/types.js';
import type { SupportedBinanceSymbol } from '../../shared/binance-symbols.js';
import { toTimestampMs } from '../../shared/date-utils.js';
import type { NoirCircuitInput } from '../types.js';

export interface ZkTLSProcessorInput {
  startTime: Date;
  endTime: Date;
  symbol: SupportedBinanceSymbol;
  baseBalance: number;
  threshold: number;
}

// Singleton so ethers tracks nonce internally across tasks
let primusInstance: PrimusNetwork | null = null;

async function getPrimus(): Promise<PrimusNetwork> {
  if (primusInstance) return primusInstance;

  const provider = new ethers.providers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.PRIMUS_PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, env.PRIMUS_CHAIN_ID);
  primusInstance = primus;
  return primus;
}

async function resumePrimusFlow(
  taskId: string,
  primus: PrimusNetwork,
  symbol: SupportedBinanceSymbol,
  startTimeMs: number,
  endTimeMs: number,
  chainId: number,
): Promise<VerifiedHyperliquidAttestation> {
  const doc = await Task.findById(taskId).lean();
  const loaded = (doc?.primus ?? null) as PrimusCheckpoint | null;
  const existing =
    loaded && Date.now() - loaded.submit.submittedAt <= TASK_TIMEOUT_MS ? loaded : null;

  let submit = existing?.submit;
  if (!submit) {
    submit = await primusSubmit(primus);
    await Task.setPrimusCheckpoint(taskId, { submit });
  }

  let attest = existing?.attest;
  if (!attest) {
    attest = await primusAttest(primus, submit, symbol, startTimeMs, endTimeMs);
    await Task.setPrimusCheckpoint(taskId, { submit, attest });
  }

  let verified = existing?.verified;
  if (!verified) {
    verified = await primusVerify(primus, submit, attest, chainId);
    await Task.setPrimusCheckpoint(taskId, { submit, attest, verified });
  }

  return verified;
}

export async function runZkTLSProcessor(
  taskId: string,
  input: ZkTLSProcessorInput,
): Promise<NoirCircuitInput> {
  const { startTime, endTime, symbol, baseBalance, threshold } = input;
  const startTimeMs = toTimestampMs(startTime);
  const endTimeMs = toTimestampMs(endTime);

  const primus = await getPrimus();
  const rawfillsResponse = await fetchRawFills(
    env.BINANCE_API_URL,
    env.BINANCE_API_KEY,
    env.BINANCE_API_SECRET,
    symbol,
    startTimeMs,
    endTimeMs,
  );
  const verified = await resumePrimusFlow(
    taskId,
    primus,
    symbol,
    startTimeMs,
    endTimeMs,
    env.PRIMUS_CHAIN_ID,
  );
  const fillsCommitment = getFillsCommitment(verified);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);
  const fillsCommitmentField2 = bytes32ToField2DecStrings(fillsCommitmentBytes);
  const rawFillsPadded = padRawFills(rawfillsResponse);

  return {
    fillsCommitment: fillsCommitmentField2,
    rawFills: rawFillsPadded.padded,
    rawFillsLength: rawFillsPadded.length,
    startTime: startTimeMs,
    endTime: endTimeMs,
    baseBalance,
    threshold,
  };
}
