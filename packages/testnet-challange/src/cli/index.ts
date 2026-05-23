#!/usr/bin/env node

import { confirm } from '@inquirer/prompts';

import { getCorruptionMask } from '../corruption.js';
import { RECORD_COUNT, type AnswerVerdict, type PresentedRecord } from '../types.js';
import { applyCorruption } from './flow/apply-corruption.js';
import { compileCircuit } from './flow/compile-circuit.js';
import { connectWallet } from './flow/connect-wallet.js';
import { deriveVerificationKey } from './flow/derive-vk.js';
import { collectAnswers } from './flow/present-records.js';
import { submitAnswers } from './lib/api-client.js';
import { API_URL } from './lib/constants.js';
import recordsData from '../data/records.json' with { type: 'json' };

const MAX_RETRIES_PER_SESSION = 50;

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
  console.log('Knidos Testnet Challenge');
  console.log(`API: ${API_URL}`);
  console.log('');

  const credentials = await connectWallet();
  console.log('');
  console.log(`  ✓ Authenticated as ${credentials.address}`);
  console.log('');

  console.log('  Step 2 of 2 — Verify and grade the records');
  console.log('');
  console.log('  Compiling circuit from Noir source… (~1.5 min)');
  const compiled = await compileCircuit();
  console.log(`  ✓ Compiled bytecode in ${(compiled.elapsedMs / 1000).toFixed(1)}s`);
  console.log('');
  console.log('  Deriving verification key… (~30 sec, ~6 GB peak RAM)');
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
      console.log('  Visit knidos.xyz to claim your achievement.');
      console.log('');
      return;
    }

    console.log('');
    console.log(`  ${result.score}/${RECORD_COUNT} correct`);
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
