#!/usr/bin/env node

import { confirm } from '@inquirer/prompts';

import { getCorruptionMask } from '../corruption.js';
import { RECORD_COUNT, RECORD_THRESHOLD, type AnswerVerdict, type PresentedRecord } from '../types.js';
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

    // The server re-derives the same deterministic mask, verifies the SIWE
    // signature, and records the result — it's the authority on the score.
    // Every attempt is submitted so each result gets recorded.
    const { score } = await submitAnswers({
      message: credentials.message,
      signature: credentials.signature,
      answers,
    });
    const perfect = score === RECORD_COUNT;

    console.log('');
    if (score >= RECORD_THRESHOLD) {
      console.log(`  ${score}/${RECORD_COUNT} correct — your answers have been recorded.`);
    } else {
      console.log(`  ${score}/${RECORD_COUNT} correct.`);
    }

    // A perfect run is the only "you're done" state — no point asking to retry.
    if (perfect) {
      console.log('  🎉 A perfect run — every record correct.');
      console.log('');
      return;
    }
    console.log('');

    // No pass/fail framing — anyone can try again if they want.
    const retry = await confirm({
      message: 'Try again?',
      default: true,
    });
    if (!retry) {
      console.log('');
      console.log('  Bye. Run the container again whenever you want to try.');
      console.log('');
      return;
    }
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
