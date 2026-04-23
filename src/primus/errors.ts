import { collectErrorStrings } from '../utils/error.js';

// The real rate-limit signal is Binance's "Operation too frequent"
// message forwarded through the attestor. The SDK's error codes like
// '00000' are generic failure codes and were causing false positives.
const RATE_LIMIT_TOKEN = 'operation too frequent';
const RATE_LIMIT_DELAY_SECONDS = 30;
const RATE_LIMIT_MAX_DELAY_SECONDS = 300;
const TRANSIENT_RPC_DELAY_MS = 60_000;
// Revert reason string is defined in Task.sol L77.
const CAPACITY_EXHAUSTED_MESSAGE = 'unsettled task count exceed max count';
const TRANSIENT_PRIMUS_TRANSPORT_TOKENS = [
  'primusservernetworkerror',
  'websocket header error',
  'recv websocket header error',
  'unstable internet connection',
];
const TRANSIENT_RPC_TOKENS = [
  'bad response',
  'timeout',
  'timed out',
  'aborted', // AbortController timeout, e.g. Binance fetch hitting our 30s ceiling
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
const TRANSIENT_RPC_STATUS_CODES = new Set([429, 502, 503, 504]);

// Errors that will keep reproducing until an operator intervenes.
// Must be checked BEFORE TRANSIENT_RPC_TOKENS because ethers wraps
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

export type ZkTLSErrorDecision =
  | DeferredTaskDecision<'primus_rate_limited' | 'primus_transient_rpc'>
  | { action: 'fail' };

export type ErrorClass = 'primus_rate_limited' | 'primus_transient_rpc' | 'permanent' | 'unknown';

export function classifyError(err: unknown): ErrorClass {
  if (isPrimusRateLimited(err)) return 'primus_rate_limited';
  if (isPermanentFailure(err)) return 'permanent';
  if (isTransientPrimusRpc(err)) return 'primus_transient_rpc';
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
  return normalizedErrorText(error).includes(RATE_LIMIT_TOKEN);
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

export function isTransientPrimusRpc(error: unknown): boolean {
  const text = normalizedErrorText(error);
  if (TRANSIENT_PRIMUS_TRANSPORT_TOKENS.some((token) => text.includes(token))) {
    return true;
  }

  if (TRANSIENT_RPC_TOKENS.some((token) => text.includes(token))) {
    return true;
  }

  return collectErrorStatusCodes(error).some((status) => TRANSIENT_RPC_STATUS_CODES.has(status));
}

function isPermanentFailure(error: unknown): boolean {
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

  if (isPrimusRateLimited(error)) {
    return deferTaskDecision({
      reason: 'primus_rate_limited',
      deferUntil: new Date(now() + getRateLimitDelayMs(args.currentDeferCount)),
      sourceError: error,
    });
  }

  // Permanent failures are checked before transient so that ethers'
  // generic SERVER_ERROR wrapper on an INSUFFICIENT_FUNDS (or similar)
  // error doesn't accidentally loop-defer forever.
  if (isPermanentFailure(error)) {
    return { action: 'fail' };
  }

  if (isTransientPrimusRpc(error)) {
    return deferTaskDecision({
      reason: 'primus_transient_rpc',
      deferUntil: new Date(now() + getTransientRpcDelayMs()),
      sourceError: error,
    });
  }

  return { action: 'fail' };
}
