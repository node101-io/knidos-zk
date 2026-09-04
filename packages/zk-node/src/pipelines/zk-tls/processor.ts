import { createHash } from 'crypto';

import { Task } from '../../db/task.js';

import { clearPrimusCheckpoint, setPrimusCheckpoint } from '../../db/task-helpers.js';
import {
  buildUserFillsRequest,
  fetchRawFillsByRequest,
  type RawFills,
} from '../../utils/fetch-raw-fills.js';
import { bytes32ToField2DecStrings } from '../../utils/bytes32-to-field2-dec-strings.js';
import { PermanentTaskError } from '../../utils/error.js';
import { hexToFixedBytes } from '../../utils/hex-to-fixed-bytes.js';
import { padRawFills } from '../../utils/pad-raw-fills.js';
import {
  attestPrimusTask,
  verifyPrimusTask,
  type PrimusAttest,
  type PrimusCheckpoint,
  type PrimusCommitments,
  type PrimusSubmit,
} from '../../primus/task.js';
import { primusClient } from '../../primus/client.js';
import { submitWithCapacity } from '../../primus/capacity.js';
import {
  deferTaskDecision,
  getTransientRpcDelayMs,
  isAttestorTransport,
  isDeferredTaskDecision,
  type DeferredTaskDecision,
} from '../../primus/errors.js';
import { MAX_FILLS, MAX_RAW_FILLS_BYTES } from '../../shared/circuit-limits.js';
import logger from '../../shared/logger.js';
import { toTimestampMs } from '../../shared/date-utils.js';
import type { NoirCircuitInput } from '../types.js';

export interface ZkTLSProcessorInput {
  startTime: Date;
  endTime: Date;
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

// The circuit hashes a fixed 42-byte address string plus a 16-byte salt.
const ADDRESS_STRING_LENGTH = 42;
const SALT_LENGTH = 16;
const BODY_PREVIEW_LENGTH = 512;

type ZkTLSGuardDeferReason = 'hyperliquid_response_invalid' | 'primus_commitment_mismatch';

export async function runZkTLSProcessor(
  taskId: string,
  input: ZkTLSProcessorInput,
): Promise<ZkTLSProcessorResult> {
  const startTimeMs = toTimestampMs(input.startTime);
  const endTimeMs = toTimestampMs(input.endTime);

  await rejectIfBeyondCircuitCapacity(startTimeMs, endTimeMs);

  // The scheduler stages tasks as DEFERRED until 5 minutes past endTime
  // (see services/scheduler.ts) so that by the time we get here, Hyperliquid's
  // read replicas have settled and both fetches below see the same body.
  const primusResult = await resumePrimusFlow(taskId, startTimeMs, endTimeMs);
  if (isDeferredTaskDecision(primusResult)) return primusResult;

  const { commitments, attest } = primusResult;
  const rawFills = await fetchRawFillsByRequest(attest.request);
  const guardResult = await validateAttestedFills(taskId, rawFills, commitments, attest);
  if (guardResult !== true) return guardResult;

  return {
    action: 'completed',
    input: buildNoirInput(commitments, attest, rawFills, startTimeMs, endTimeMs, input),
  };
}

// A window wider than the circuit can take is unprovable no matter what the
// attestor says, so look at the body once, cheaply, before paying for a
// Primus task on it. Only capacity is judged here; anything else about the
// body is left to the attested fetch below.
async function rejectIfBeyondCircuitCapacity(
  startTimeMs: number,
  endTimeMs: number,
): Promise<void> {
  const raw = await fetchRawFillsByRequest(buildUserFillsRequest(startTimeMs, endTimeMs));
  let fills: unknown;
  try {
    fills = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
  } catch {
    return;
  }
  if (!Array.isArray(fills)) return;

  if (fills.length > MAX_FILLS || raw.length > MAX_RAW_FILLS_BYTES) {
    throw new PermanentTaskError(
      `window exceeds circuit capacity: ${fills.length} fills / ${raw.length} bytes (max ${MAX_FILLS} fills / ${MAX_RAW_FILLS_BYTES} bytes); shorten ZKTLS_WINDOW_MINUTES`,
    );
  }
}

interface PrimusFlowSuccess {
  commitments: PrimusCommitments;
  attest: PrimusAttest;
}

async function resumePrimusFlow(
  taskId: string,
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

    // `primus` is a Mixed field, so a checkpoint from an older build may lack
    // the request or a salt; anything incomplete is re-attested.
    let attest = submitFresh?.attest;
    if (!attest?.request || !attest.fillsSalt || !attest.addressSalt) {
      attest = undefined;
    }

    if (!attest) {
      const request = buildUserFillsRequest(startTimeMs, endTimeMs);
      // A fresh SDK each attempt forces findFastestWs to re-run, so a
      // retry that targets a different attestor doesn't carry over any
      // cached pick from the previous one.
      const primus = await primusClient.sdk();
      try {
        attest = await attestPrimusTask(primus, submit, request);
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
    const commitments = await verifyPrimusTask(primus, submit, attest);
    return { commitments, attest };
  }

  throw lastAttestError ?? new Error('attestation_retry_exhausted');
}

async function validateAttestedFills(
  taskId: string,
  rawFills: RawFills,
  commitments: PrimusCommitments,
  attest: PrimusAttest,
): Promise<true | DeferredTaskDecision<ZkTLSGuardDeferReason>> {
  const rawBuffer = Buffer.from(rawFills);
  const bodyText = rawBuffer.toString('utf8');
  const bodyPreview = bodyText.slice(0, BODY_PREVIEW_LENGTH);
  let parsed: unknown;

  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return deferAfterGuardFailure(
      taskId,
      'hyperliquid_response_invalid',
      guardError('hyperliquid_response_invalid', 'Hyperliquid userFills response is not JSON', {
        bodyPreview,
      }),
    );
  }

  if (!Array.isArray(parsed)) {
    return deferAfterGuardFailure(
      taskId,
      'hyperliquid_response_invalid',
      guardError(
        'hyperliquid_response_invalid',
        'Hyperliquid userFills response is not a JSON array',
        { bodyPreview },
      ),
    );
  }

  const expectedCommitment = Buffer.from(hexToFixedBytes(commitments.fillsCommitment, 32)).toString(
    'hex',
  );
  // Mirror the attestor's SHA256_WITH_SALT: sha256(body || salt).
  const actualCommitment = createHash('sha256')
    .update(rawBuffer)
    .update(hexToFixedBytes(attest.fillsSalt, SALT_LENGTH))
    .digest('hex');
  if (actualCommitment !== expectedCommitment) {
    return deferAfterGuardFailure(
      taskId,
      'primus_commitment_mismatch',
      guardError(
        'primus_commitment_mismatch',
        'Primus fills commitment does not match the fetched Hyperliquid response',
        { expectedCommitment, actualCommitment, rawFillsLength: rawFills.length, bodyPreview },
      ),
    );
  }

  return true;
}

async function deferAfterGuardFailure(
  taskId: string,
  reason: ZkTLSGuardDeferReason,
  sourceError: unknown,
): Promise<DeferredTaskDecision<ZkTLSGuardDeferReason>> {
  await clearPrimusCheckpoint(taskId);
  return deferTaskDecision({
    reason,
    deferUntil: new Date(Date.now() + getTransientRpcDelayMs()),
    sourceError,
  });
}

function guardError(
  reason: ZkTLSGuardDeferReason,
  message: string,
  details: Record<string, unknown>,
): Record<string, unknown> {
  return { name: 'ZkTLSGuardError', message, reason, ...details };
}

function buildNoirInput(
  commitments: PrimusCommitments,
  attest: PrimusAttest,
  rawFillsResponse: RawFills,
  startTimeMs: number,
  endTimeMs: number,
  input: ZkTLSProcessorInput,
): NoirCircuitInput {
  // Read the address back out of the attested request: this is the exact
  // string the attestor hashed for addressCommitment, so it stays correct
  // even if HYPERLIQUID_USER_ADDRESS changed since the attestation.
  const addressBytes = Buffer.from(attest.request.body.user, 'utf8');
  if (addressBytes.length !== ADDRESS_STRING_LENGTH) {
    throw new Error(
      `[zkTLS processor] expected a ${ADDRESS_STRING_LENGTH}-byte address string, got ${addressBytes.length}`,
    );
  }

  const padded = padRawFills(rawFillsResponse);
  return {
    addressCommitment: bytes32ToField2DecStrings(
      hexToFixedBytes(commitments.addressCommitment, 32),
    ),
    fillsCommitment: bytes32ToField2DecStrings(hexToFixedBytes(commitments.fillsCommitment, 32)),
    address: Array.from(addressBytes),
    addressSalt: Array.from(hexToFixedBytes(attest.addressSalt, SALT_LENGTH)),
    fillsSalt: Array.from(hexToFixedBytes(attest.fillsSalt, SALT_LENGTH)),
    rawFills: padded.padded,
    rawFillsLength: padded.length,
    startTime: startTimeMs,
    endTime: endTimeMs,
    baseBalance: input.baseBalance,
    threshold: input.threshold,
  };
}
