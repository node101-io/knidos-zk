import { promises as fs } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { runNoirProcessor, type NoirProcessorResult } from '../src/pipelines/noir/processor.js';
import { getSharedNoirRuntime } from '../src/pipelines/noir/runtime.js';
import { parseNoirCircuitInput } from '../src/pipelines/validation.js';

const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'noir-circuit-input.json');

const hasFixture = await fs
  .access(FIXTURE_PATH)
  .then(() => true)
  .catch(() => false);
const itWithFixture = hasFixture ? it : it.skip;

let noirResult: NoirProcessorResult | undefined;

function normalizeFixture(rawFixture: unknown): unknown {
  if (
    rawFixture !== null &&
    typeof rawFixture === 'object' &&
    'rawFillsText' in rawFixture &&
    typeof (rawFixture as { rawFillsText: unknown }).rawFillsText === 'string'
  ) {
    const fixture = rawFixture as {
      fillsCommitment: unknown;
      rawFillsText: string;
      startTime: unknown;
      endTime: unknown;
      baseBalance: unknown;
      threshold: unknown;
    };
    const rawFills = Array.from(Buffer.from(fixture.rawFillsText, 'utf8'));
    const paddedRawFills = rawFills.concat(Array(8192 - rawFills.length).fill(0));

    return {
      fillsCommitment: fixture.fillsCommitment,
      rawFills: paddedRawFills,
      rawFillsLength: rawFills.length,
      startTime: fixture.startTime,
      endTime: fixture.endTime,
      baseBalance: fixture.baseBalance,
      threshold: fixture.threshold,
    };
  }

  return rawFixture;
}

async function loadFixture() {
  const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
  return parseNoirCircuitInput(normalizeFixture(JSON.parse(raw)));
}

describe('ZK proof pipeline', () => {
  it('compiles the circuit and generates a verification key', async () => {
    const runtime = await getSharedNoirRuntime();
    expect(runtime.program).toBeDefined();
    expect(runtime.vk).toBeInstanceOf(Uint8Array);
    expect(runtime.vk.length).toBeGreaterThan(0);
  });

  itWithFixture('generates a proof', async () => {
    const input = await loadFixture();
    noirResult = await runNoirProcessor(0, {
      zkTLSTaskId: 'test',
      symbol: 'BTCUSDT',
      startTime: new Date(input.startTime),
      endTime: new Date(input.endTime),
      circuitInput: input,
    });

    expect(noirResult.proofHex).toMatch(/^0x[0-9a-f]+$/);
    expect(noirResult.vkHex).toMatch(/^0x[0-9a-f]+$/);
    expect(noirResult.publicInputs.length).toBeGreaterThan(0);
  });

  itWithFixture('submits proof to zkVerify', async () => {
    if (noirResult === undefined) {
      const input = await loadFixture();
      noirResult = await runNoirProcessor(0, {
        zkTLSTaskId: 'test',
        symbol: 'BTCUSDT',
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        circuitInput: input,
      });
    }

    const { runZkVerifyProcessor } = await import('../src/pipelines/zk-verify/processor.js');
    const result = await runZkVerifyProcessor({
      vk: noirResult.vkHex,
      proof: noirResult.proofHex,
      publicSignals: noirResult.publicInputs,
    });

    expect(result.includedInBlock).toBeDefined();
  });
});
