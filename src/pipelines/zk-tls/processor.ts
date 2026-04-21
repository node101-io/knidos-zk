import type { PrimusNetwork } from '@primuslabs/network-core-sdk';

import Task from '../../db/task.js';
import { env } from '../../env.js';
import { fetchRawFills, type RawFills } from '../../utils/fetch-raw-fills.js';
import { bytes32ToField2DecStrings } from '../../utils/bytes32-to-field2-dec-strings.js';
import { hexToFixedBytes } from '../../utils/hex-to-fixed-bytes.js';
import { padRawFills } from '../../utils/pad-raw-fills.js';
import {
  attestPrimusTask,
  verifyPrimusTask,
  type PrimusCheckpoint,
  type PrimusSubmit,
} from '../../primus/task.js';
import { primusClient } from '../../primus/client.js';
import { submitWithCapacity } from '../../primus/capacity.js';
import { isDeferredTaskDecision, type DeferredTaskDecision } from '../../primus/errors.js';
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

export type ZkTLSProcessorResult =
  | { action: 'completed'; input: NoirCircuitInput }
  | DeferredTaskDecision;

export async function runZkTLSProcessor(
  taskId: string,
  input: ZkTLSProcessorInput,
): Promise<ZkTLSProcessorResult> {
  const startTimeMs = toTimestampMs(input.startTime);
  const endTimeMs = toTimestampMs(input.endTime);

  const [primus, rawFills] = await Promise.all([
    primusClient.sdk(),
    fetchRawFills(
      env.BINANCE_API_URL,
      env.BINANCE_API_KEY,
      env.BINANCE_API_SECRET,
      input.symbol,
      startTimeMs,
      endTimeMs,
    ),
  ]);

  const fillsCommitment = await resumePrimusFlow(
    taskId,
    primus,
    input.symbol,
    startTimeMs,
    endTimeMs,
  );
  if (isDeferredTaskDecision(fillsCommitment)) return fillsCommitment;

  return {
    action: 'completed',
    input: buildNoirInput(fillsCommitment, rawFills, startTimeMs, endTimeMs, input),
  };
}

async function resumePrimusFlow(
  taskId: string,
  primus: PrimusNetwork,
  symbol: SupportedBinanceSymbol,
  startTimeMs: number,
  endTimeMs: number,
): Promise<string | DeferredTaskDecision> {
  const [doc, taskTimeoutMs] = await Promise.all([
    Task.findById(taskId).lean(),
    primusClient.taskTimeoutMs(),
  ]);
  const checkpoint = (doc?.primus ?? null) as PrimusCheckpoint | null;
  const fresh =
    checkpoint && Date.now() - checkpoint.submit.submittedAt <= taskTimeoutMs ? checkpoint : null;

  let submit: PrimusSubmit;
  if (fresh?.submit) {
    submit = fresh.submit;
  } else {
    const submitted = await submitWithCapacity();
    if (isDeferredTaskDecision(submitted)) return submitted;
    submit = submitted;
    await Task.setPrimusCheckpoint(taskId, { submit });
  }

  let attest = fresh?.attest;
  if (!attest) {
    attest = await attestPrimusTask(primus, submit, symbol, startTimeMs, endTimeMs);
    await Task.setPrimusCheckpoint(taskId, { submit, attest });
  }

  return verifyPrimusTask(primus, submit, attest);
}

function buildNoirInput(
  fillsCommitment: string,
  rawFillsResponse: RawFills,
  startTimeMs: number,
  endTimeMs: number,
  input: ZkTLSProcessorInput,
): NoirCircuitInput {
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);
  const padded = padRawFills(rawFillsResponse);
  return {
    fillsCommitment: bytes32ToField2DecStrings(fillsCommitmentBytes),
    rawFills: padded.padded,
    rawFillsLength: padded.length,
    startTime: startTimeMs,
    endTime: endTimeMs,
    baseBalance: input.baseBalance,
    threshold: input.threshold,
  };
}
