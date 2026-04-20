import { BigNumber, ethers } from 'ethers';

import logger from '../shared/logger.js';
import { primusClient, TOKEN_SYMBOL_ETH } from './client.js';
import {
  deferTaskDecision,
  getTransientRpcDelayMs,
  isPrimusCapacityExhaustedError,
  type DeferredTaskDecision,
} from './errors.js';
import { submitPrimusTaskRaw, type PrimusSubmit } from './task.js';

// ---- Policy constants --------------------------------------------------
//
// MIN_RECLAIM_BATCH: only pay the withdrawBalance gas when at least this
// many timed-out tasks have piled up, so the per-task amortized cost is
// bounded. 80 is the middle of sensible values given ~1476 µETH per
// withdraw tx on Base Sepolia (≈18 µETH/task at 80). This is not an env
// knob because the trade-off is cost-vs-latency and the accumulation
// rate at healthy failure rates means days pass before a second reclaim
// would ever fire.
//
// BATCH_WAIT_MS: how long to defer when we're saturated but haven't
// accumulated enough timed-out tasks to justify a reclaim. Re-check
// after this interval; either more timed out or something succeeded.
//
// GRACE_MS: padding added to nextUnlockAt to avoid firing exactly at
// the boundary and hitting a race with the contract's block timestamp.
//
// CAPACITY_RETRY_DELAY_MS: tiny retry window for the very rare case
// where our view snapshot said "free slot" but the raw submitTask
// reverted with capacity exhausted anyway. Usually indicates someone
// else submitted in between.
//
// RECLAIM_GAS_LIMIT: ceiling for withdrawBalance. Historical max on
// Base Sepolia is ~1.53M; 3M buys ~2x headroom. We set an explicit
// gasLimit because some Base Sepolia RPCs incorrectly bail on
// eth_estimateGas with "intrinsic gas too high" for txs that execute
// fine on-chain (observed across public, Alchemy, Tenderly, drpc).
// Unused gas is not charged by the EVM.

const MIN_RECLAIM_BATCH = 80;
const BATCH_WAIT_MS = 30_000;
const GRACE_MS = 15_000;
const CAPACITY_RETRY_DELAY_MS = 1_000;
const RECLAIM_GAS_LIMIT = 3_000_000;

// ---- Types -------------------------------------------------------------

interface Snapshot {
  total: number;
  freeSlots: number;
  timedOutCount: number;
  nextUnlockAt: Date | null;
}

type CapacityDeferReason =
  | 'primus_transient_rpc'
  | 'primus_capacity_full_wait'
  | 'primus_capacity_batch_wait';

// ---- Pure policy -------------------------------------------------------
//
// Given a snapshot, decide what to do. No I/O; trivially testable.

function decideAction(s: Snapshot): 'submit' | 'reclaim' | CapacityDeferReason {
  if (s.freeSlots > 0) return 'submit';
  if (s.timedOutCount >= MIN_RECLAIM_BATCH) return 'reclaim';
  if (s.timedOutCount === 0) return 'primus_capacity_full_wait';
  return 'primus_capacity_batch_wait';
}

// ---- Public API --------------------------------------------------------

export async function submitWithCapacity(): Promise<
  PrimusSubmit | DeferredTaskDecision<CapacityDeferReason | 'primus_capacity_retry'>
> {
  const first = await evaluate();
  if (first.kind === 'defer') return first.decision;

  try {
    return await submitPrimusTaskRaw();
  } catch (error) {
    if (!isPrimusCapacityExhaustedError(error)) throw error;
    // A race between our view-call snapshot and submitTask. Re-evaluate
    // (which may reclaim) and try once more. If still exhausted, defer.
    const second = await evaluate({ sourceError: error });
    if (second.kind === 'defer') return second.decision;
    try {
      return await submitPrimusTaskRaw();
    } catch (retryError) {
      if (!isPrimusCapacityExhaustedError(retryError)) throw retryError;
      return deferTaskDecision({
        reason: 'primus_capacity_retry',
        deferUntil: new Date(Date.now() + CAPACITY_RETRY_DELAY_MS),
        sourceError: retryError,
      });
    }
  }
}

// Script-level entry: unconditionally reclaim any timed-out tasks. If
// none are timed out, the contract reverts with "No task fee can be
// withdrawn" — callers should catch that.
export async function reclaimTimedOutTasks(): Promise<{ settled: string[] }> {
  const limit = await primusClient.maxUnsettledTaskCount();
  return { settled: await withdrawTimedOut(limit) };
}

// ---- I/O shell ---------------------------------------------------------

async function evaluate(
  args: { sourceError?: unknown } = {},
): Promise<
  | { kind: 'proceed'; snapshot: Snapshot }
  | { kind: 'defer'; decision: DeferredTaskDecision<CapacityDeferReason> }
> {
  try {
    const s = await snapshot();
    const action = decideAction(s);

    if (action === 'submit') {
      log('submit', s);
      return { kind: 'proceed', snapshot: s };
    }

    if (action === 'reclaim') {
      const limit = await primusClient.maxUnsettledTaskCount();
      const settled = await withdrawTimedOut(limit);
      const refreshed = await snapshot();
      log('reclaim', refreshed, { settledCount: settled.length });
      if (refreshed.freeSlots > 0) return { kind: 'proceed', snapshot: refreshed };
      return { kind: 'defer', decision: deferFromSnapshot(refreshed, args.sourceError) };
    }

    // action is a CapacityDeferReason
    return {
      kind: 'defer',
      decision: deferFromSnapshot(s, args.sourceError, action),
    };
  } catch (error) {
    return {
      kind: 'defer',
      decision: deferTaskDecision({
        reason: 'primus_transient_rpc',
        deferUntil: new Date(Date.now() + getTransientRpcDelayMs()),
        sourceError: args.sourceError ?? error,
      }),
    };
  }
}

function deferFromSnapshot(
  s: Snapshot,
  sourceError: unknown,
  reasonHint?: CapacityDeferReason,
): DeferredTaskDecision<CapacityDeferReason> {
  const reason: CapacityDeferReason =
    reasonHint ??
    (s.freeSlots === 0 && s.timedOutCount === 0
      ? 'primus_capacity_full_wait'
      : 'primus_capacity_batch_wait');
  const deferUntil =
    reason === 'primus_capacity_full_wait' && s.nextUnlockAt
      ? s.nextUnlockAt
      : new Date(Date.now() + BATCH_WAIT_MS);

  log('defer', s, { reason, deferUntil });
  return deferTaskDecision({ reason, deferUntil, sourceError });
}

async function withdrawTimedOut(limit: number): Promise<string[]> {
  const contract = primusClient.contract();
  const tx = (await contract.withdrawBalance(TOKEN_SYMBOL_ETH, limit, {
    gasLimit: RECLAIM_GAS_LIMIT,
  })) as ethers.ContractTransaction;
  const receipt = await tx.wait();
  const event = receipt.events?.find((e) => e.event === 'WithdrawBalance');
  return (event?.args?.settledTaskIds ?? []) as string[];
}

async function snapshot(): Promise<Snapshot> {
  const [max, timeoutMs, unsettled] = await Promise.all([
    primusClient.maxUnsettledTaskCount(),
    primusClient.taskTimeoutMs(),
    primusClient.contract().queryUnsettledTasks(
      primusClient.userAddress,
      TOKEN_SYMBOL_ETH,
      0,
      200,
    ) as Promise<{ taskInfos: { submittedAt: BigNumber }[]; totalCount: BigNumber }>,
  ]);

  const total = unsettled.totalCount.toNumber();
  const timeoutSec = Math.floor(timeoutMs / 1000);
  const nowSec = Math.floor(Date.now() / 1000);

  let timedOutCount = 0;
  let oldestSec = Number.POSITIVE_INFINITY;
  for (const t of unsettled.taskInfos) {
    const at = t.submittedAt.toNumber();
    if (at + timeoutSec < nowSec) timedOutCount++;
    if (at < oldestSec) oldestSec = at;
  }

  return {
    total,
    freeSlots: Math.max(0, max - total),
    timedOutCount,
    nextUnlockAt: Number.isFinite(oldestSec)
      ? new Date(oldestSec * 1000 + timeoutMs + GRACE_MS)
      : null,
  };
}

function log(action: string, s: Snapshot, extra: Record<string, unknown> = {}): void {
  logger.info(
    {
      action,
      total: s.total,
      free: s.freeSlots,
      timedOut: s.timedOutCount,
      nextUnlockAt: s.nextUnlockAt,
      ...extra,
    },
    '[primus capacity]',
  );
}
