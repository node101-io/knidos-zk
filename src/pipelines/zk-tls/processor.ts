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
import {
  isAttestorTransport,
  isDeferredTaskDecision,
  type DeferredTaskDecision,
} from '../../primus/errors.js';
import logger from '../../shared/logger.js';
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

// Per-worker-invocation budget for re-submitting on attestor transport
// failures. Each retry burns one more on-chain submitTask gas (~13µETH
// at our pinned fees) but forces the contract to pick a new attestor —
// the only escape when the SDK's chosen attestor websocket is dead. 3
// fits inside our 2-min worker lockDuration with margin (each attest
// timeout is ~12s).
const ATTEST_MAX_ATTEMPTS = 3;

export async function runZkTLSProcessor(
  taskId: string,
  input: ZkTLSProcessorInput,
): Promise<ZkTLSProcessorResult> {
  const startTimeMs = toTimestampMs(input.startTime);
  const endTimeMs = toTimestampMs(input.endTime);

  const [rawFills, fillsCommitmentOrDefer] = await Promise.all([
    fetchRawFills(
      env.BINANCE_API_URL,
      env.BINANCE_API_KEY,
      env.BINANCE_API_SECRET,
      input.symbol,
      startTimeMs,
      endTimeMs,
    ),
    resumePrimusFlow(taskId, input.symbol, startTimeMs, endTimeMs),
  ]);
  if (isDeferredTaskDecision(fillsCommitmentOrDefer)) return fillsCommitmentOrDefer;

  return {
    action: 'completed',
    input: buildNoirInput(fillsCommitmentOrDefer, rawFills, startTimeMs, endTimeMs, input),
  };
}

async function resumePrimusFlow(
  taskId: string,
  symbol: SupportedBinanceSymbol,
  startTimeMs: number,
  endTimeMs: number,
): Promise<string | DeferredTaskDecision> {
  const taskTimeoutMs = await primusClient.taskTimeoutMs();
  let lastAttestError: unknown;

  for (let attempt = 1; attempt <= ATTEST_MAX_ATTEMPTS; attempt++) {
    const doc = await Task.findById(taskId).lean();
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
      // A fresh SDK each attempt forces findFastestWs to re-run, so a
      // retry that targets a different attestor doesn't carry over any
      // cached pick from the previous one.
      const primus = await primusClient.sdk();
      try {
        attest = await attestPrimusTask(primus, submit, symbol, startTimeMs, endTimeMs);
      } catch (err) {
        lastAttestError = err;
        if (attempt < ATTEST_MAX_ATTEMPTS && isAttestorTransport(err)) {
          // Drop the on-chain submit checkpoint so the next iteration
          // re-submits and the contract assigns a different attestor.
          // Without this, the same dead attestor keeps being reused
          // for the full taskTimeoutMs window (~15 min).
          await Task.clearPrimusCheckpoint(taskId);
          logger.warn(
            { taskId, attempt, error: err },
            '[zkTLS processor] attestor transport failed, retrying with fresh submit',
          );
          continue;
        }
        throw err;
      }
      await Task.setPrimusCheckpoint(taskId, { submit, attest });
    }

    const primus = await primusClient.sdk();
    return verifyPrimusTask(primus, submit, attest);
  }

  throw lastAttestError ?? new Error('attestation_retry_exhausted');
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
