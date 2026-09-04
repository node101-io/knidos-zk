/**
 * One-shot zkVerify submission check.
 *
 * Generates a fresh UltraHonk proof from the test fixture and submits it to the
 * configured zkVerify network, printing the resulting statement / aggregation
 * info. Use this to verify the zkverifyjs 3.x + UltrahonkVersion.V0_84 upgrade
 * end-to-end without the vitest harness.
 *
 *   ZKVERIFY_NETWORK=volta tsx --env-file=.env \
 *     packages/zk-node/src/scripts/zkverify-submit-once.ts
 *
 * Local note: pnpm-launched scripts may not always inherit the user's shell
 * PATH exactly. Before generating the proof, we make sure the resolved `nargo`
 * directory is present in process.env.PATH.
 */
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

import mongoose from 'mongoose';

import { env } from '../env.js';
import { runNoirProcessor } from '../pipelines/noir/processor.js';
import { parseNoirCircuitInput } from '../pipelines/validation.js';
import { runZkVerifyProcessor } from '../pipelines/zk-verify/processor.js';

const FIXTURE_PATH = path.resolve('packages/zk-node/tests/fixtures/noir-circuit-input.json');

function ensureNargoOnPath(): void {
  try {
    const nargoPath = execFileSync('which', ['nargo'], { encoding: 'utf8' }).trim();
    const nargoDir = path.dirname(nargoPath);
    const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);

    if (!pathEntries.includes(nargoDir)) {
      process.env.PATH = [nargoDir, ...pathEntries].join(path.delimiter);
    }

    console.log(`[submit-once] nargo=${nargoPath}`);
  } catch {
    console.warn('[submit-once] could not resolve nargo from PATH');
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
      addressCommitment: unknown;
      address: unknown;
      addressSalt: unknown;
      fillsSalt: unknown;
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
      addressCommitment: fixture.addressCommitment,
      address: fixture.address,
      addressSalt: fixture.addressSalt,
      fillsSalt: fixture.fillsSalt,
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

const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
const fixture = parseNoirCircuitInput(normalizeFixture(JSON.parse(raw)));

ensureNargoOnPath();

console.log(`[submit-once] network=${env.ZKVERIFY_NETWORK}`);
console.log('[submit-once] generating proof via noir pipeline...');
const noir = await runNoirProcessor(0, {
  zkTLSTaskId: 'submit-once',
  startTime: new Date(fixture.startTime),
  endTime: new Date(fixture.endTime),
  circuitInput: fixture,
});
console.log(
  `[submit-once] proof ready: proof=${noir.proofHex.length} hex chars, ` +
    `publicInputs=${noir.publicInputs.length}`,
);

await mongoose.connect(env.MONGO_URI);
console.log('[submit-once] mongo connected; submitting to zkVerify...');
try {
  const result = await runZkVerifyProcessor({
    vk: noir.vkHex,
    proof: noir.proofHex,
    publicSignals: noir.publicInputs,
  });
  console.log('[submit-once] SUCCESS — submitted and included.');
  console.log('  statement     :', result.statement ?? '(none)');
  console.log('  aggregationId :', result.aggregationId ?? '(none)');
  console.log('  txHash        :', result.includedInBlock?.txHash ?? '(none)');
  console.log('  blockHash     :', result.includedInBlock?.blockHash ?? '(none)');
} catch (error) {
  // zkverifyjs embeds the full (binary) proof in some error messages; strip
  // non-printable bytes and truncate so the real reason stays readable.
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-control-regex
  const clean = message
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 600);
  console.error('[submit-once] FAILED:', clean);
} finally {
  await mongoose.disconnect();
}
process.exit(0);
