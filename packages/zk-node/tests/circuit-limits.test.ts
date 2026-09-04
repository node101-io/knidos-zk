import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_FILLS, MAX_RAW_FILLS_BYTES } from '../src/shared/circuit-limits.js';

// The TypeScript limits guard windows before they reach the circuit, so they
// must say exactly what the Noir source says. Read the .nr files rather than
// trusting a comment: a drift here would let unprovable windows through or
// reject provable ones, silently.
const CIRCUIT_SRC = path.resolve(__dirname, '..', '..', '..', 'circuit', 'src');

describe('circuit limits mirror the Noir source', () => {
  it('MAX_FILLS matches parser.nr', async () => {
    const parser = await fs.readFile(path.join(CIRCUIT_SRC, 'parser.nr'), 'utf8');
    const match = parser.match(/^global MAX_FILLS: u32 = (\d+);/m);

    expect(match, 'parser.nr should declare global MAX_FILLS').not.toBeNull();
    expect(Number(match![1])).toBe(MAX_FILLS);
  });

  it('MAX_RAW_FILLS_BYTES matches the rawFills width in main.nr', async () => {
    const main = await fs.readFile(path.join(CIRCUIT_SRC, 'main.nr'), 'utf8');
    const match = main.match(/rawFills: \[u8; (\d+)\]/);

    expect(match, 'main.nr should declare rawFills: [u8; N]').not.toBeNull();
    expect(Number(match![1])).toBe(MAX_RAW_FILLS_BYTES);
  });
});
