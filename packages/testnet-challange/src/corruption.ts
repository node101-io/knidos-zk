import { createHash } from 'node:crypto';

import {
  CORRUPTION_STATES,
  RECORD_COUNT,
  type AnswerVerdict,
  type CorruptionState,
} from './types.js';

function normalizeAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`invalid eth address: ${address}`);
  }
  return address.toLowerCase();
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getCorruptionMask(address: string): CorruptionState[] {
  const normalized = normalizeAddress(address);
  const digest = createHash('sha256').update(`knidos-challenge-v1:${normalized}`).digest();
  const seedInt = digest.readUInt32BE(0);
  const rng = mulberry32(seedInt);
  return Array.from({ length: RECORD_COUNT }, () => {
    const idx = Math.floor(rng() * CORRUPTION_STATES.length);
    return CORRUPTION_STATES[idx] as CorruptionState;
  });
}

// Project the corruption mask into the binary "is this record valid" view
// that the user actually grades.
export function expectedVerdicts(mask: CorruptionState[]): AnswerVerdict[] {
  return mask.map((s) => (s === 'valid' ? 'valid' : 'invalid'));
}

export function scoreAnswers(
  expected: AnswerVerdict[],
  given: AnswerVerdict[],
): number {
  if (expected.length !== given.length) return 0;
  let n = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === given[i]) n++;
  }
  return n;
}
