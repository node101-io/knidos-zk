import type { RawFills } from './fetch-raw-fills.js';

const MAX_FILLS_LEN = 8192;

export function padRawFills(raw: RawFills): {
  padded: number[];
  length: number;
} {
  if (raw.length > MAX_FILLS_LEN) {
    throw new Error('bad_request');
  }

  const padded = new Uint8Array(MAX_FILLS_LEN);
  padded.set(raw);

  return {
    padded: Array.from(padded),
    length: raw.length,
  };
}
