import mongoose from 'mongoose';

import Task from '../db/task.js';
import { env } from '../env.js';
import {
  getDistinctWaveEndTimesDesc,
  getRetainedWaveEndTimes,
  getWaveRetentionCutoff,
} from '../services/task-wave-retention.js';

const DEFAULT_KEEP_WAVES = 3;
const KEEP_WAVES_PREFIX = '--keep-waves=';

interface CliArgs {
  keepWaves: number;
  apply: boolean;
}

function parseKeepWaves(rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid --keep-waves value: ${rawValue}`);
  }

  return value;
}

function parseArgs(): CliArgs {
  const keepWavesArg = process.argv.find((arg) => arg.startsWith(KEEP_WAVES_PREFIX));
  return {
    keepWaves: keepWavesArg
      ? parseKeepWaves(keepWavesArg.slice(KEEP_WAVES_PREFIX.length))
      : DEFAULT_KEEP_WAVES,
    apply: process.argv.includes('--apply'),
  };
}

function formatWaveList(waves: Date[]): string {
  return waves.map((wave) => wave.toISOString()).join(', ');
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('[prune-task-waves] disabled when NODE_ENV=production');
  }

  const { keepWaves, apply } = parseArgs();

  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

  try {
    const rawWaveEndTimes = await Task.distinct('input.endTime', { type: 'zkTLS' });
    const allWaveEndTimes = getDistinctWaveEndTimesDesc(rawWaveEndTimes);

    if (allWaveEndTimes.length === 0) {
      console.log('[prune-task-waves] No zkTLS waves found. Nothing to prune.');
      return;
    }

    const retainedWaveEndTimes = getRetainedWaveEndTimes(rawWaveEndTimes, keepWaves);
    const cutoff = getWaveRetentionCutoff(rawWaveEndTimes, keepWaves);

    if (!cutoff) {
      console.log('[prune-task-waves] No valid zkTLS wave timestamps found. Nothing to prune.');
      return;
    }

    const prunableWaveEndTimes = allWaveEndTimes.filter((waveEndTime) => waveEndTime < cutoff);

    console.log(
      `[prune-task-waves] Keeping newest ${retainedWaveEndTimes.length} wave(s): ${formatWaveList(
        retainedWaveEndTimes,
      )}`,
    );

    if (prunableWaveEndTimes.length === 0) {
      console.log(
        `[prune-task-waves] Nothing older than the newest ${keepWaves} wave(s). No zkTLS task documents were deleted.`,
      );
      return;
    }

    const deleteMatch = {
      type: 'zkTLS',
      'input.endTime': { $lt: cutoff },
    } as const;

    const deleteCount = await Task.countDocuments(deleteMatch);

    console.log(
      `[prune-task-waves] Found ${prunableWaveEndTimes.length} older wave(s) to prune from zkTLS: ${formatWaveList(
        prunableWaveEndTimes,
      )}`,
    );
    console.log(`[prune-task-waves] Matching zkTLS task count: ${deleteCount}`);

    if (!apply) {
      console.log(
        `[prune-task-waves] Dry run only. Re-run with --apply to delete ${deleteCount} zkTLS task(s).`,
      );
      return;
    }

    const result = await Task.deleteMany(deleteMatch);
    console.log(
      `[prune-task-waves] Deleted ${result.deletedCount} zkTLS task(s) across ${prunableWaveEndTimes.length} older wave(s).`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

await main();
