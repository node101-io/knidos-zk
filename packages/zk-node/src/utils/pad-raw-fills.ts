import { MAX_RAW_FILLS_BYTES } from '../shared/circuit-limits.js';
import type { RawFills } from './fetch-raw-fills.js';

// A response wider than the circuit buffer cannot be proven at all, so this is
// a permanent failure for the window rather than something to defer and
// retry. Say so in the message: the task error is what an operator reads.
export function padRawFills(raw: RawFills): {
  padded: number[];
  length: number;
} {
  if (raw.length > MAX_RAW_FILLS_BYTES) {
    throw new Error(
      `raw fills exceed circuit buffer: ${raw.length} bytes > ${MAX_RAW_FILLS_BYTES}; shorten ZKTLS_WINDOW_MINUTES`,
    );
  }

  const padded = new Uint8Array(MAX_RAW_FILLS_BYTES);
  padded.set(raw);

  return {
    padded: Array.from(padded),
    length: raw.length,
  };
}
