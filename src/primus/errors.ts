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
const TRANSIENT_RPC_TOKENS = [
  'timeout',
  'timed out',
  'econnreset',
  'econnrefused',
  'enotfound',
  'etimedout',
  'network error',
  'socket hang up',
  'server_error',
  'temporary',
  'gateway timeout',
  '503',
  '429',
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

function isTransientPrimusRpc(error: unknown): boolean {
  const text = normalizedErrorText(error);
  return TRANSIENT_RPC_TOKENS.some((token) => text.includes(token));
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

  if (isTransientPrimusRpc(error)) {
    return deferTaskDecision({
      reason: 'primus_transient_rpc',
      deferUntil: new Date(now() + getTransientRpcDelayMs()),
      sourceError: error,
    });
  }

  return { action: 'fail' };
}
