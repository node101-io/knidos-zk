import { promises as fs } from 'fs';
import path from 'path';

import type { TestProject } from 'vitest/node';

import { runNoirProcessor } from '../../src/pipelines/noir/processor.js';
import { parseNoirCircuitInput } from '../../src/pipelines/validation.js';
import type { NoirCircuitInput } from '../../src/pipelines/types.js';

const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'noir-circuit-input.json');

export interface ProvidedNoirProof {
  proofHex: string;
  vkHex: string;
  publicInputs: string[];
  fixture: NoirCircuitInput;
}

declare module 'vitest' {
  export interface ProvidedContext {
    noirProof: ProvidedNoirProof | null;
  }
}

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

export default async function setup(project: TestProject): Promise<void> {
  const exists = await fs
    .access(FIXTURE_PATH)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    project.provide('noirProof', null);
    return;
  }

  const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
  const fixture = parseNoirCircuitInput(normalizeFixture(JSON.parse(raw)));

  const result = await runNoirProcessor(0, {
    zkTLSTaskId: 'test',
    symbol: 'BTCUSDT',
    startTime: new Date(fixture.startTime),
    endTime: new Date(fixture.endTime),
    circuitInput: fixture,
  });

  project.provide('noirProof', {
    proofHex: result.proofHex,
    vkHex: result.vkHex,
    publicInputs: result.publicInputs,
    fixture,
  });
}
