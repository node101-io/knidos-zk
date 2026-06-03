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
//   pnpm --filter testnet-challenge snapshot-records

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

import { RECORD_COUNT, type PresentedRecord } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '../src/data/records.json');

// Minimum gap between a time-decoy's settlement (createdAt) and the
// displayed record's startTime. Anything smaller (a few minutes, an hour)
// is too easy to overlook on the explorer — 24h makes the temporal
// mismatch unambiguous at a glance.
const TIME_DECOY_MIN_GAP_MS = 24 * 60 * 60 * 1000;

interface SampledRecord {
  publicSignals: string[];
  txHash: string;
  startTime: Date;
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

    // To guarantee a 'time' decoy is findable for every sampled record, we
    // must only sample records whose startTime is later than the createdAt
    // of the (RECORD_COUNT+1)th oldest record in the current-vkHash pool —
    // *plus* the minimum gap we require between decoy.createdAt and
    // sampled.startTime. That way, even if every other sampled record also
    // lands in that earliest-tail and gets excluded, at least one decoy
    // with the required temporal distance remains.
    const earliestPool = (await col
      .aggregate([
        { $match: { vkHash: targetVkHash, txHash: { $exists: true, $ne: null } } },
        { $sort: { createdAt: 1 } },
        { $limit: RECORD_COUNT + 1 },
        { $project: { _id: 0, createdAt: 1 } },
      ])
      .toArray()) as unknown as { createdAt: Date }[];
    if (earliestPool.length < RECORD_COUNT + 1) {
      throw new Error(
        `pool for vkHash ${targetVkHash} has fewer than ${RECORD_COUNT + 1} records; need more history to construct time-decoys`,
      );
    }
    const sampleableAfter = new Date(
      earliestPool[RECORD_COUNT]!.createdAt.getTime() + TIME_DECOY_MIN_GAP_MS,
    );

    // Pass 1: pick one record per distinct fillsCommitment pair (first two
    // public signals) so the user sees as many genuinely different proofs as
    // the pool allows — not just different time windows over the same batch.
    const distinct = (await col
      .aggregate([
        {
          $match: {
            vkHash: targetVkHash,
            txHash: { $exists: true, $ne: null },
            startTime: { $gt: sampleableAfter },
          },
        },
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
        { $project: { _id: 0, publicSignals: 1, txHash: 1, startTime: 1 } },
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
              startTime: { $gt: sampleableAfter },
            },
          },
          { $sample: { size: remaining } },
          { $project: { _id: 0, publicSignals: 1, txHash: 1, startTime: 1 } },
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

    // Decoys: real txHashes from previous circuit versions (different
    // vkHash). The 'tx' corruption mode swaps these in, so the explorer
    // link opens to a genuine settled proof — but one that verifies
    // against a stale VK, so a vigilant user spots the mismatch. We pull
    // publicSignals too so the displayed inputs match what the on-chain
    // proof actually commits to; VK mismatch is the sole intended tell.
    const decoys = (await col
      .aggregate([
        {
          $match: {
            vkHash: { $ne: targetVkHash },
            txHash: { $exists: true, $ne: null },
            publicSignals: { $exists: true, $ne: null },
          },
        },
        { $sample: { size: RECORD_COUNT } },
        { $project: { _id: 0, txHash: 1, publicSignals: 1 } },
      ])
      .toArray()) as unknown as { txHash: string; publicSignals: string[] }[];

    if (decoys.length < RECORD_COUNT) {
      throw new Error(
        `need ${RECORD_COUNT} decoy txHashes under a different vkHash, only ${decoys.length} available`,
      );
    }

    // Time decoys: real on-chain txs with the *current* vkHash, but settled
    // (createdAt) at least TIME_DECOY_MIN_GAP_MS before the displayed
    // record's own startTime — so the explorer shows a tx mined well
    // before the data window it claims to cover. The gap is enforced so
    // the mismatch is glanceable (a sub-hour delta is too easy to miss).
    // Used by the 'time' corruption mode. We pick one per sampled record
    // to ensure the temporal predicate holds for that specific record's
    // startTime.
    const sampledTxHashes = sampled.map((r) => r.txHash);
    const timeDecoyTxHashes: string[] = [];
    for (const r of sampled) {
      const decoyMaxCreatedAt = new Date(r.startTime.getTime() - TIME_DECOY_MIN_GAP_MS);
      const [pick] = (await col
        .aggregate([
          {
            $match: {
              vkHash: targetVkHash,
              txHash: { $exists: true, $ne: null, $nin: sampledTxHashes },
              createdAt: { $lt: decoyMaxCreatedAt },
            },
          },
          { $sample: { size: 1 } },
          { $project: { _id: 0, txHash: 1 } },
        ])
        .toArray()) as unknown as { txHash: string }[];
      if (!pick) {
        throw new Error(
          `no current-vkHash decoy with createdAt < ${decoyMaxCreatedAt.toISOString()} found for record txHash ${r.txHash}`,
        );
      }
      timeDecoyTxHashes.push(pick.txHash);
    }

    const out: PresentedRecord[] = sampled.map((r, i) => ({
      publicSignals: r.publicSignals,
      txHash: r.txHash,
      decoyTxHash: decoys[i]!.txHash,
      decoyPublicSignals: decoys[i]!.publicSignals,
      decoyTimeTxHash: timeDecoyTxHashes[i]!,
    }));

    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
    console.log(
      `Wrote ${OUT_PATH} (${out.length} records + ${decoys.length} stale-vk decoys + ${timeDecoyTxHashes.length} time decoys)`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
