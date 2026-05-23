// Snapshot exactly RECORD_COUNT verification records into
// src/data/records.json. Connects to MongoDB (MONGO_URI from .env.prod) and
// reads the verificationrecords collection directly. All picks must share
// the latest record's vkHash so the bundled set is consistent with the VK
// currently registered on zkverify. We prefer fillsCommitment diversity:
// each pick is a distinct (publicSignals[0], publicSignals[1]) pair when
// possible. If the pool has fewer than RECORD_COUNT distinct pairs, the
// remaining slots are filled with additional records from the same vkHash
// pool (duplicate fillsCommitment allowed, txHash always unique).
//
//   pnpm --filter testnet-challange snapshot-records

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

import { RECORD_COUNT, type PresentedRecord } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '../src/data/records.json');

interface SampledRecord {
  publicSignals: string[];
  txHash: string;
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI env var is required');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const col = mongoose.connection.collection('verificationrecords');

    const latest = (await col.findOne(
      { txHash: { $exists: true, $ne: null } },
      { sort: { createdAt: -1 }, projection: { vkHash: 1 } },
    )) as { vkHash: string } | null;
    if (!latest) throw new Error('no records with a txHash found');
    const targetVkHash = latest.vkHash;
    console.log(`latest record vkHash: ${targetVkHash}`);

    // Pass 1: pick one record per distinct fillsCommitment pair (first two
    // public signals) so the user sees as many genuinely different proofs as
    // the pool allows — not just different time windows over the same batch.
    const distinct = (await col
      .aggregate([
        { $match: { vkHash: targetVkHash, txHash: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: {
              fc0: { $arrayElemAt: ['$publicSignals', 0] },
              fc1: { $arrayElemAt: ['$publicSignals', 1] },
            },
            doc: { $first: '$$ROOT' },
          },
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sample: { size: RECORD_COUNT } },
        { $project: { _id: 0, publicSignals: 1, txHash: 1 } },
      ])
      .toArray()) as unknown as SampledRecord[];

    // Pass 2: if Pass 1 didn't fill all slots, pad with extra records from
    // the same vkHash pool (fillsCommitment may repeat, but txHash must not).
    let sampled: SampledRecord[] = distinct;
    const remaining = RECORD_COUNT - distinct.length;
    if (remaining > 0) {
      const usedTxHashes = distinct.map((r) => r.txHash);
      const fillers = (await col
        .aggregate([
          {
            $match: {
              vkHash: targetVkHash,
              txHash: { $exists: true, $ne: null, $nin: usedTxHashes },
            },
          },
          { $sample: { size: remaining } },
          { $project: { _id: 0, publicSignals: 1, txHash: 1 } },
        ])
        .toArray()) as unknown as SampledRecord[];
      sampled = [...distinct, ...fillers];
    }

    if (sampled.length < RECORD_COUNT) {
      throw new Error(
        `need ${RECORD_COUNT} records under the latest vkHash, only ${sampled.length} available (distinct fillsCommitment pairs: ${distinct.length})`,
      );
    }
    console.log(
      `picked ${sampled.length} records (${distinct.length} distinct fillsCommitment pairs)`,
    );

    const out: PresentedRecord[] = sampled.map((r) => ({
      publicSignals: r.publicSignals,
      txHash: r.txHash,
    }));

    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
    console.log(`Wrote ${OUT_PATH} (${out.length} records)`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
