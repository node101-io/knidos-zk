import { promises as fs } from 'fs';
import path from 'path';

import { runZkTLSProcessor } from '../src/pipelines/zk-tls/processor.js';

const FIXTURE_PATH = path.resolve('tests', 'fixtures', 'noir-circuit-input.json');

const START_TIME = 1769172979000;
const END_TIME = 1769172996000;

const input = await runZkTLSProcessor({
  startTime: START_TIME,
  endTime: END_TIME,
  baseBalance: 100000000,
  threshold: 50000000,
});

await fs.mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
await fs.writeFile(FIXTURE_PATH, JSON.stringify(input, null, 2));

console.log(`Fixture written to ${FIXTURE_PATH}`);
