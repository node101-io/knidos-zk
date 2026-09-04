import { describe, expect, it } from 'vitest';

import { MAX_RAW_FILLS_BYTES } from '../src/shared/circuit-limits.js';
import { padRawFills } from '../src/utils/pad-raw-fills.js';

describe('padRawFills', () => {
  it('zero-pads a response to the circuit buffer width', () => {
    const { padded, length } = padRawFills(new Uint8Array([91, 93]));

    expect(length).toBe(2);
    expect(padded).toHaveLength(MAX_RAW_FILLS_BYTES);
    expect(padded.slice(0, 3)).toEqual([91, 93, 0]);
  });

  it('rejects a response wider than the buffer with an actionable message', () => {
    expect(() => padRawFills(new Uint8Array(MAX_RAW_FILLS_BYTES + 1))).toThrow(
      /8193 bytes > 8192; shorten ZKTLS_WINDOW_MINUTES/,
    );
  });
});
