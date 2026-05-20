import { normalizeDateInput, toTimestampMs } from '../shared/date-utils.js';

function assertKeepWaves(keepWaves: number): void {
  if (!Number.isInteger(keepWaves) || keepWaves < 1) {
    throw new Error('keepWaves must be a positive integer');
  }
}

export function getDistinctWaveEndTimesDesc(rawValues: unknown[]): Date[] {
  const byTimestamp = new Map<number, Date>();

  for (const rawValue of rawValues) {
    const endTime = normalizeDateInput(rawValue);
    if (!endTime) continue;
    byTimestamp.set(toTimestampMs(endTime), endTime);
  }

  return [...byTimestamp.values()].sort((left, right) => right.getTime() - left.getTime());
}

export function getRetainedWaveEndTimes(rawValues: unknown[], keepWaves: number): Date[] {
  assertKeepWaves(keepWaves);
  return getDistinctWaveEndTimesDesc(rawValues).slice(0, keepWaves);
}

export function getWaveRetentionCutoff(rawValues: unknown[], keepWaves: number): Date | null {
  const retained = getRetainedWaveEndTimes(rawValues, keepWaves);
  return retained.at(-1) ?? null;
}
