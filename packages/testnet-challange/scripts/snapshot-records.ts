// Snapshot 5 random verification records from the last 7 days into
// src/cli/data/records.json. Reads from the existing exported dump
// (test.verificationrecords.json at repo root). Proofs themselves are no
// longer bundled — the user inspects each settlement tx on the zkVerify
// explorer to grade records.
//
//   pnpm --filter testnet-challange snapshot-records

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PresentedRecord } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DUMP_PATH = path.join(REPO_ROOT, 'test.verificationrecords.json');
const OUT_PATH = path.resolve(__dirname, '../src/cli/data/records.json');

const RECORDS_TO_SAMPLE = 5;
const SEVEN_DAYS_MS = 7 * 86400 * 1000;

interface RawRecord {
  publicSignals: string[];
  txHash: string;
  createdAt: { $date: string } | string;
}

function toDate(v: { $date: string } | string): Date {
  return new Date(typeof v === 'string' ? v : v.$date);
}

function pickRandom<T>(array: T[], n: number): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const ci = copy[i];
    const cj = copy[j];
    if (ci === undefined || cj === undefined) continue;
    copy[i] = cj;
    copy[j] = ci;
  }
  return copy.slice(0, n);
}

async function main(): Promise<void> {
  const raw = await fs.readFile(DUMP_PATH, 'utf8');
  const records = JSON.parse(raw) as RawRecord[];

  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const recent = records.filter((r) => toDate(r.createdAt).getTime() >= cutoff);
  console.log(`${recent.length} records in last 7 days`);

  const picked = pickRandom(recent, RECORDS_TO_SAMPLE);
  const out: PresentedRecord[] = picked.map((r) => ({
    publicSignals: r.publicSignals,
    txHash: r.txHash,
  }));

  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${OUT_PATH} (${out.length} records)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
