import { PermanentTaskError, collectErrorStrings } from '../utils/error.js';

// Two distinct rate-limit signals can reach us:
//   1. Hyperliquid's "Operation too frequent" forwarded through the attestor.
//   2. The Primus gateway's own "Too many requests..." response (returned
//      with code "00000" — the SDK's generic failure code, so we have to
//      key off the message text rather than the code).
// Both are transient and should defer with backoff, not fail.
const RATE_LIMIT_TOKENS = ['operation too frequent', 'too many requests'] as const;
const RATE_LIMIT_DELAY_SECONDS = 30;
const RATE_LIMIT_MAX_DELAY_SECONDS = 300;
const TRANSIENT_RPC_DELAY_MS = 60_000;
// Above this many consecutive defers we mark the task FAILED rather
// than letting it cycle forever. Reason: a sustained Primus attestor
// outage was producing tasks with deferCount in the 30s while the
// queue grew unbounded. Failed tasks can be revived with
// `pnpm tasks:retry` once the upstream is healthy. Permanent failures
// (insufficient funds / nonce) still short-circuit before this cap.
const MAX_DEFERS = 50;
// Revert reason string is defined in Task.sol L77.
const CAPACITY_EXHAUSTED_MESSAGE = 'unsettled task count exceed max count';
// Tokens that pinpoint the Primus attestor's MPC websocket transport
// (the "offline" phase of the SDK's attest()). When these fire, no
// amount of waiting on the same on-chain submit helps — the attestor
// the contract picked is unreachable. The fix is to invalidate the
// checkpoint and re-submit so the contract picks a different attestor;
// see processor.ts attest retry loop.
const ATTESTOR_TRANSPORT_TOKENS = [
  'primusservernetworkerror',
  'websocket header error',
  'recv websocket header error',
  'unstable internet connection',
];
// Tokens for transient HTTP / RPC failures (Base RPC 5xx, timeouts,
// AbortController). These point at network or upstream-RPC issues —
// not at a specific Primus attestor — so a simple time-based defer is
// the right action.
const RPC_TRANSIENT_TOKENS = [
  'bad response',
  'timeout',
  'timed out',
  'aborted', // AbortController timeout, e.g. Hyperliquid fetch hitting our 30s ceiling
  'econnreset',
  'econnrefused',
  'enotfound',
  'etimedout',
  'network error',
  'socket hang up',
  'temporary',
  'gateway timeout',
  '502',
  '503',
  '429',
  '504',
  'error code: 502',
  'error code: 503',
  'error code: 504',
];
const RPC_TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);

// Errors that will keep reproducing until an operator intervenes.
// Must be checked BEFORE the transient classifiers because ethers wraps
// everything in a SERVER_ERROR code; the permanent reason only
// shows up deeper in the error payload, and a looser "server_error"
// transient match would mask it.
const PERMANENT_FAILURE_TOKENS = [
  'insufficient funds', // wallet balance too low — needs top-up
  'insufficient_funds', // ethers-v5 error code
  'nonce too low', // broken nonce tracking
  'nonce_expired', // ethers-v5 error code
  'replacement fee too low',
];

export interface DeferredTaskDecision<Reason extends string = string> {
  action: 'defer';
  reason: Reason;
  deferUntil: Date;
  sourceError?: unknown;
}

export type ZkTLSDeferReason =
  | 'primus_rate_limited'
  | 'primus_attestor_transient'
  | 'primus_rpc_transient'
  | 'hyperliquid_response_invalid'
  | 'primus_commitment_mismatch';

export type ZkTLSErrorDecision = DeferredTaskDecision<ZkTLSDeferReason> | { action: 'fail' };

export type ErrorClass =
  | 'primus_rate_limited'
  | 'primus_attestor_transient'
  | 'primus_rpc_transient'
  | 'permanent'
  | 'unknown';

export function classifyError(err: unknown): ErrorClass {
  if (isPrimusRateLimited(err)) return 'primus_rate_limited';
  if (isPermanentFailure(err)) return 'permanent';
  if (isAttestorTransport(err)) return 'primus_attestor_transient';
  if (isRpcTransient(err)) return 'primus_rpc_transient';
  return 'unknown';
}

export function deferTaskDecision<Reason extends string>(args: {
  reason: Reason;
  deferUntil: Date;
  sourceError?: unknown;
}): DeferredTaskDecision<Reason> {
  return {
    action: 'defer',
    reason: args.reason,
    deferUntil: args.deferUntil,
    sourceError: args.sourceError,
  };
}

export function isDeferredTaskDecision(value: unknown): value is DeferredTaskDecision {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'action' in value &&
    (value as { action?: unknown }).action === 'defer' &&
    'reason' in value &&
    'deferUntil' in value,
  );
}

function normalizedErrorText(error: unknown): string {
  return collectErrorStrings(error).join(' | ').toLowerCase();
}

function isPrimusRateLimited(error: unknown): boolean {
  const text = normalizedErrorText(error);
  return RATE_LIMIT_TOKENS.some((token) => text.includes(token));
}

export function collectErrorStatusCodes(err: unknown): number[] {
  const seen = new Set<unknown>();
  const values: number[] = [];

  function add(value: unknown): void {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d{3}$/.test(value.trim())
          ? Number(value.trim())
          : null;

    if (parsed !== null && !values.includes(parsed)) {
      values.push(parsed);
    }
  }

  function visit(value: unknown): void {
    if (value == null || seen.has(value) || typeof value !== 'object') return;

    seen.add(value);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'status' || normalizedKey === 'statuscode') {
        add(entry);
      }
      visit(entry);
    }
  }

  visit(err);
  return values;
}

export function isAttestorTransport(error: unknown): boolean {
  const text = normalizedErrorText(error);
  return ATTESTOR_TRANSPORT_TOKENS.some((token) => text.includes(token));
}

export function isRpcTransient(error: unknown): boolean {
  const text = normalizedErrorText(error);
  if (RPC_TRANSIENT_TOKENS.some((token) => text.includes(token))) {
    return true;
  }
  return collectErrorStatusCodes(error).some((status) => RPC_TRANSIENT_STATUS_CODES.has(status));
}

// Backwards-compatible union — preserved so the JSON-RPC fallback
// provider keeps firing on either bucket without a separate predicate.
export function isTransientPrimusRpc(error: unknown): boolean {
  return isAttestorTransport(error) || isRpcTransient(error);
}

function isPermanentFailure(error: unknown): boolean {
  if (error instanceof PermanentTaskError) return true;
  const text = normalizedErrorText(error);
  return PERMANENT_FAILURE_TOKENS.some((token) => text.includes(token));
}

export function isPrimusCapacityExhaustedError(error: unknown): boolean {
  return normalizedErrorText(error).includes(CAPACITY_EXHAUSTED_MESSAGE);
}

export function getRateLimitDelayMs(currentDeferCount: number): number {
  const seconds = Math.min(
    RATE_LIMIT_MAX_DELAY_SECONDS,
    RATE_LIMIT_DELAY_SECONDS * 2 ** currentDeferCount,
  );
  return seconds * 1000;
}

export function getTransientRpcDelayMs(): number {
  return TRANSIENT_RPC_DELAY_MS;
}

export function decideZkTLSError(
  error: unknown,
  args: { currentDeferCount: number; now?: () => number },
): ZkTLSErrorDecision {
  const now = args.now ?? (() => Date.now());

  // Permanent failures are checked first so that ethers' generic
  // SERVER_ERROR wrapper on an INSUFFICIENT_FUNDS (or similar) error
  // doesn't accidentally loop-defer forever.
  if (isPermanentFailure(error)) {
    return { action: 'fail' };
  }

  // Cap unbounded defer cycles. Tasks that have rotated through this
  // many error-driven defers are effectively stuck; failing them
  // bounds the queue and surfaces the issue. Capacity defers go
  // through a separate path and are not capped here.
  if (args.currentDeferCount >= MAX_DEFERS) {
    return { action: 'fail' };
  }

  if (isPrimusRateLimited(error)) {
    return deferTaskDecision({
      reason: 'primus_rate_limited',
      deferUntil: new Date(now() + getRateLimitDelayMs(args.currentDeferCount)),
      sourceError: error,
    });
  }

  if (isAttestorTransport(error)) {
    return deferTaskDecision({
      reason: 'primus_attestor_transient',
      deferUntil: new Date(now() + getTransientRpcDelayMs()),
      sourceError: error,
    });
  }

  if (isRpcTransient(error)) {
    return deferTaskDecision({
      reason: 'primus_rpc_transient',
      deferUntil: new Date(now() + getTransientRpcDelayMs()),
      sourceError: error,
    });
  }

  return { action: 'fail' };
}
