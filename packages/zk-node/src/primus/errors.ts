import { PermanentTaskError, collectErrorStrings } from '../utils/error.js';

// Two distinct rate-limit signals can reach us:
//   1. Hyperliquid's "Operation too frequent" forwarded through the attestor.
//   2. A genuine "Too many requests" from an upstream HTTP layer.
// Both are transient and should defer with backoff, not fail.
//
// Not a rate limit, despite its message: the SDK's ZkAttestationError
// code "00000". The SDK raises it whenever the native addon's
// getAttestation() returns any retcode other than 0/2 and labels it with
// ErrorCodeMAP["00000"] = "Too many requests. Please try again later.".
// On 2026-09-05 that text was the only symptom of a wedged addon for 27h
// and read as Primus throttling us. It is checked by code, before the
// text tokens below, and deferred on a flat delay with no backoff.
const RATE_LIMIT_TOKENS = ['operation too frequent', 'too many requests'] as const;
const ATTEST_START_FAILED_CODE = '00000';
// How long a task waits after its attestation child was killed or died.
// The assigned attestor is not answering; the on-chain submit stays
// checkpointed so a retry within taskTimeout costs no gas. Outages have
// lasted hours, so this wait is exempt from MAX_DEFERS.
const ATTESTOR_UNRESPONSIVE_DELAY_MS = 5 * 60_000;
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

// Raised by attest-runner.ts when the attestation child never reported:
//   timeout — killed for exceeding its wall-clock budget
//   crash   — exited (or never started) on its own; the native addon
//             exits the process on some socket errors
// Either way the attestor is not answering right now. (An SDK error
// inside the child is rethrown as-is and classified as before.)
export type AttestationChildFailure = 'timeout' | 'crash';

export class AttestationChildError extends Error {
  readonly kind: AttestationChildFailure;

  constructor(kind: AttestationChildFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AttestationChildError';
    this.kind = kind;
  }
}

export interface DeferredTaskDecision<Reason extends string = string> {
  action: 'defer';
  reason: Reason;
  deferUntil: Date;
  sourceError?: unknown;
  // Whether this defer counts toward MAX_DEFERS. Error-driven defers do:
  // a task that keeps erroring is stuck and should surface. A wait on an
  // attestor that is not answering does not, or a long upstream outage
  // would fail every queued window.
  consumesDeferBudget: boolean;
}

export type ZkTLSDeferReason =
  | 'primus_rate_limited'
  | 'primus_attest_start_failed'
  | 'primus_attestor_unresponsive'
  | 'primus_attestor_transient'
  | 'primus_rpc_transient'
  | 'hyperliquid_response_invalid'
  | 'primus_commitment_mismatch';

export type ZkTLSErrorDecision = DeferredTaskDecision<ZkTLSDeferReason> | { action: 'fail' };

export type ErrorClass =
  | 'primus_rate_limited'
  | 'primus_attest_start_failed'
  | 'primus_attestor_unresponsive'
  | 'primus_attestor_transient'
  | 'primus_rpc_transient'
  | 'permanent'
  | 'unknown';

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof AttestationChildError) return 'primus_attestor_unresponsive';
  if (isPrimusAttestStartFailure(err)) return 'primus_attest_start_failed';
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
  consumesDeferBudget?: boolean;
}): DeferredTaskDecision<Reason> {
  return {
    action: 'defer',
    reason: args.reason,
    deferUntil: args.deferUntil,
    sourceError: args.sourceError,
    consumesDeferBudget: args.consumesDeferBudget ?? true,
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
  if (isPrimusAttestStartFailure(error)) return false;
  const text = normalizedErrorText(error);
  return RATE_LIMIT_TOKENS.some((token) => text.includes(token));
}

function isPrimusAttestStartFailure(error: unknown): boolean {
  return collectErrorFieldValues(error, new Set(['code'])).some(
    (value) => value === ATTEST_START_FAILED_CODE,
  );
}

// Every value stored under one of `keys` anywhere in the error graph,
// depth-first. Errors are walked by own-property name so non-enumerable
// fields (`cause`, ethers' `code`) are seen; plain objects by key.
function collectErrorFieldValues(err: unknown, keys: ReadonlySet<string>): unknown[] {
  const seen = new Set<unknown>();
  const values: unknown[] = [];

  function visit(value: unknown): void {
    if (value == null || seen.has(value) || typeof value !== 'object') return;

    seen.add(value);
    const names = value instanceof Error ? Object.getOwnPropertyNames(value) : Object.keys(value);
    for (const key of names) {
      const entry = (value as Record<string, unknown>)[key];
      if (keys.has(key.toLowerCase())) {
        values.push(entry);
      }
      visit(entry);
    }
  }

  visit(err);
  return values;
}

const STATUS_CODE_KEYS = new Set(['status', 'statuscode']);

export function collectErrorStatusCodes(err: unknown): number[] {
  const values: number[] = [];

  for (const value of collectErrorFieldValues(err, STATUS_CODE_KEYS)) {
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

  if (error instanceof AttestationChildError) {
    return deferTaskDecision({
      reason: 'primus_attestor_unresponsive',
      deferUntil: new Date(now() + ATTESTOR_UNRESPONSIVE_DELAY_MS),
      sourceError: error,
      consumesDeferBudget: false,
    });
  }

  // Cap unbounded defer cycles. Tasks that have rotated through this
  // many error-driven defers are effectively stuck; failing them
  // bounds the queue and surfaces the issue. Capacity defers go
  // through a separate path and are not capped here.
  if (args.currentDeferCount >= MAX_DEFERS) {
    return { action: 'fail' };
  }

  if (isPrimusAttestStartFailure(error)) {
    return deferTaskDecision({
      reason: 'primus_attest_start_failed',
      deferUntil: new Date(now() + getTransientRpcDelayMs()),
      sourceError: error,
    });
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
