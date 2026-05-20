import { describe, expect, inject, it } from 'vitest';

function toPaddedHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

describe('Noir proof', () => {
  const proof = inject('noirProof');
  const run = proof ? it : it.skip;

  run('produces well-formed proof and verification key hex', () => {
    expect(proof!.proofHex).toMatch(/^0x[0-9a-f]+$/);
    expect(proof!.vkHex).toMatch(/^0x[0-9a-f]+$/);
  });

  run('public inputs match the fixture commitment and time window', () => {
    const { publicInputs, fixture } = proof!;
    expect(publicInputs).toEqual([
      toPaddedHex(BigInt(fixture.fillsCommitment[0]!)),
      toPaddedHex(BigInt(fixture.fillsCommitment[1]!)),
      toPaddedHex(BigInt(fixture.startTime)),
      toPaddedHex(BigInt(fixture.endTime)),
    ]);
  });
});
