import { promises as fs } from 'fs';
import path from 'path';

import { runZkTLSProcessor } from '../pipelines/zk-tls/processor.js';
import type { NoirCircuitInput } from '../pipelines/types.js';

const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'noir-circuit-input.json');

const START_TIME = 1769172979000;
const END_TIME = 1769172996000;

function toCompactFixture(input: NoirCircuitInput) {
  const rawFillsText = Buffer.from(input.rawFills.slice(0, input.rawFillsLength)).toString('utf8');

  return {
    fillsCommitment: input.fillsCommitment,
    rawFillsText,
    startTime: input.startTime,
    endTime: input.endTime,
    baseBalance: input.baseBalance,
    threshold: input.threshold,
  };
}

const input = await runZkTLSProcessor({
  startTime: new Date(START_TIME),
  endTime: new Date(END_TIME),
  symbol: 'BTCUSDT',
  baseBalance: 100000000,
  threshold: 50000000,
});

await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
await fs.writeFile(FIXTURE_PATH, JSON.stringify(toCompactFixture(input), null, 2));

console.log(`Fixture written to ${FIXTURE_PATH}`);
