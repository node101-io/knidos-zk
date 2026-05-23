import { Task } from '../../db/task.js';
import { type SupportedBinanceSymbol } from '../../shared/binance-symbols.js';

import { clearPrimusCheckpoint, setPrimusCheckpoint } from '../../db/task-helpers.js';
import { env } from '../../env.js';
import {
  buildUserTradesUrl,
  fetchRawFillsByUrl,
  type RawFills,
} from '../../utils/fetch-raw-fills.js';
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

// A Primus attestation's URL embeds the Binance `timestamp`, and Binance
// rejects requests where `timestamp` is more than `recvWindow` ms behind
// server time (we use 60s). We re-attest if a cached attest result is older
// than this cutoff so the refetch never runs into `-1021`.
const ATTESTED_URL_MAX_AGE_MS = 50_000;

export async function runZkTLSProcessor(
  taskId: string,
  input: ZkTLSProcessorInput,
): Promise<ZkTLSProcessorResult> {
  const startTimeMs = toTimestampMs(input.startTime);
  const endTimeMs = toTimestampMs(input.endTime);

  // The scheduler stages tasks as DEFERRED until 5 minutes past endTime
  // (see services/scheduler.ts) so that by the time we get here, Binance's
  // read replicas have settled and both fetches below see the same body.
  const primusResult = await resumePrimusFlow(taskId, input.symbol, startTimeMs, endTimeMs);
  if (isDeferredTaskDecision(primusResult)) return primusResult;

  const { fillsCommitment, url } = primusResult;
  const rawFills = await fetchRawFillsByUrl(url, env.BINANCE_API_KEY);

  return {
    action: 'completed',
    input: buildNoirInput(fillsCommitment, rawFills, startTimeMs, endTimeMs, input),
  };
}

interface PrimusFlowSuccess {
  fillsCommitment: string;
  url: string;
}

async function resumePrimusFlow(
  taskId: string,
  symbol: SupportedBinanceSymbol,
  startTimeMs: number,
  endTimeMs: number,
): Promise<PrimusFlowSuccess | DeferredTaskDecision> {
  const taskTimeoutMs = await primusClient.taskTimeoutMs();
  let lastAttestError: unknown;

  for (let attempt = 1; attempt <= ATTEST_MAX_ATTEMPTS; attempt++) {
    const doc = await Task.findById(taskId).lean();
    const checkpoint = (doc?.primus ?? null) as PrimusCheckpoint | null;
    const submitFresh =
      checkpoint && Date.now() - checkpoint.submit.submittedAt <= taskTimeoutMs ? checkpoint : null;

    let submit: PrimusSubmit;
    if (submitFresh?.submit) {
      submit = submitFresh.submit;
    } else {
      const submitted = await submitWithCapacity();
      if (isDeferredTaskDecision(submitted)) return submitted;
      submit = submitted;
      await setPrimusCheckpoint(taskId, { submit });
    }

    // A cached attest pins the URL we'll refetch from. If the URL's Binance
    // `timestamp` is already older than the cutoff, the refetch would hit
    // `-1021 Timestamp outside of recvWindow`; re-attest with a fresh URL.
    let attest = submitFresh?.attest;
    if (attest && Date.now() - attest.attestedAt > ATTESTED_URL_MAX_AGE_MS) {
      attest = undefined;
    }

    if (!attest) {
      const url = buildUserTradesUrl(
        env.BINANCE_API_URL,
        env.BINANCE_API_SECRET,
        symbol,
        startTimeMs,
        endTimeMs,
      );
      // A fresh SDK each attempt forces findFastestWs to re-run, so a
      // retry that targets a different attestor doesn't carry over any
      // cached pick from the previous one.
      const primus = await primusClient.sdk();
      try {
        attest = await attestPrimusTask(primus, submit, url);
      } catch (err) {
        lastAttestError = err;
        if (attempt < ATTEST_MAX_ATTEMPTS && isAttestorTransport(err)) {
          // Drop the on-chain submit checkpoint so the next iteration
          // re-submits and the contract assigns a different attestor.
          // Without this, the same dead attestor keeps being reused
          // for the full taskTimeoutMs window (~15 min).
          await clearPrimusCheckpoint(taskId);
          logger.warn(
            { taskId, attempt, error: err },
            '[zkTLS processor] attestor transport failed, retrying with fresh submit',
          );
          continue;
        }
        throw err;
      }
      await setPrimusCheckpoint(taskId, { submit, attest });
    }

    const primus = await primusClient.sdk();
    const fillsCommitment = await verifyPrimusTask(primus, submit, attest);
    return { fillsCommitment, url: attest.url };
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
