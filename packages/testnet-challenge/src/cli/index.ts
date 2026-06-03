#!/usr/bin/env node

import { confirm } from '@inquirer/prompts';

import { expectedVerdicts, getCorruptionMask, scoreAnswers } from '../corruption.js';
import { PASS_THRESHOLD, RECORD_COUNT, type AnswerVerdict, type PresentedRecord } from '../types.js';
import { applyCorruption } from './flow/apply-corruption.js';
import { compileCircuit } from './flow/compile-circuit.js';
import { connectWallet } from './flow/connect-wallet.js';
import { deriveVerificationKey } from './flow/derive-vk.js';
import { collectAnswers } from './flow/present-records.js';
import { submitAnswers } from './lib/api-client.js';
import recordsData from '../data/records.json' with { type: 'json' };
import logo from './assets/logo.ans';

const MAX_RETRIES_PER_SESSION = 50;

// Local grading is instant, but printing "X/5 correct" the moment the user
// hits Enter looks like nothing was checked. Hold here for ~2.5s ± 1s so it
// reads as a real verification step.
const CHECK_DELAY_BASE_MS = 2_500;
const CHECK_DELAY_JITTER_MS = 1_000;

const records = recordsData as PresentedRecord[];

if (records.length !== RECORD_COUNT) {
  throw new Error(`bundled records.json must contain exactly ${RECORD_COUNT} records, got ${records.length}`);
}

// In distroless containers Node runs as PID 1, and Linux skips the default
// SIGINT/SIGTERM handlers for PID 1 — so Ctrl+C wouldn't kill the process
// without an explicit listener.
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

async function main(): Promise<void> {
  console.log('');
  console.log(logo);
  console.log('Welcome to Knidos ZK Proof Challenge');
  console.log('');

  const credentials = await connectWallet();
  console.log('');
  console.log(`  ✓ Authenticated as ${credentials.address}`);
  console.log('');

  console.log('  Step 2 of 2 — Verify and grade the records');
  console.log('');
  console.log('  Compiling circuit from Noir source… (~30 sec)');
  const compiled = await compileCircuit();
  console.log(`  ✓ Compiled bytecode in ${(compiled.elapsedMs / 1000).toFixed(1)}s`);
  console.log('');
  console.log('  Deriving verification key… (~30 sec)');
  const vk = await deriveVerificationKey(compiled.bytecodePath);
  console.log(`  ✓ Derived VK in ${(vk.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`    VK hash = ${vk.vkHashHex}`);
  console.log('');

  const mask = getCorruptionMask(credentials.address);
  const presented = applyCorruption(records, mask);
  // The expected verdict for each record is fully determined by the user's
  // address (deterministic mask). Grading locally skips a server round-trip
  // on the common "first attempt is wrong" path — we only hit /api/submit
  // once the answers actually pass, where the server is still the authority
  // (it re-derives the same mask + verifies the SIWE signature).
  const expected = expectedVerdicts(mask);

  let previousAnswers: AnswerVerdict[] | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_SESSION; attempt++) {
    const answers = await collectAnswers(presented, vk.vkHashHex, previousAnswers);
    previousAnswers = answers;

    console.log('');
    console.log('  Submitting answers…');
    const checkJitter = (Math.random() * 2 - 1) * CHECK_DELAY_JITTER_MS;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, CHECK_DELAY_BASE_MS + checkJitter),
    );

    const localScore = scoreAnswers(expected, answers);

    if (localScore < PASS_THRESHOLD) {
      console.log('');
      console.log(`  ${localScore}/${RECORD_COUNT} correct — need at least ${PASS_THRESHOLD} to pass`);
      console.log('');
      const retry = await confirm({
        message: 'Try again with different answers?',
        default: true,
      });
      if (!retry) {
        console.log('');
        console.log('  Bye. Run the container again whenever you want to try.');
        console.log('');
        return;
      }
      continue;
    }

    const result = await submitAnswers({
      message: credentials.message,
      signature: credentials.signature,
      answers,
    });

    if (result.passed) {
      console.log('');
      console.log(`  🎉 ${result.score}/${RECORD_COUNT} — passed`);
      console.log('');
      console.log(`  Address ${credentials.address} is now marked as completed.`);
      console.log('');
      return;
    }

    // Server disagreed with our local grading — very unlikely (mask is
    // deterministic and shared between both sides). Surface and let the
    // operator investigate.
    console.log('');
    console.log(`  Server reported ${result.score}/${RECORD_COUNT}. Re-run the CLI to try fresh.`);
    console.log('');
    return;
  }

  console.log('');
  console.log(`  Max retries (${MAX_RETRIES_PER_SESSION}) reached for this session.`);
  console.log('  Run the container again to start a fresh session.');
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('Error:', err instanceof Error ? err.message : err);
  console.error('');
  process.exit(1);
});
