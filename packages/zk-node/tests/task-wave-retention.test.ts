import { describe, expect, it } from 'vitest';

import {
  getDistinctWaveEndTimesDesc,
  getRetainedWaveEndTimes,
  getWaveRetentionCutoff,
} from '../src/services/task-wave-retention.js';

describe('task-wave-retention', () => {
  it('deduplicates and sorts wave end times descending', () => {
    const result = getDistinctWaveEndTimesDesc([
      '2026-04-22T11:15:00.000Z',
      new Date('2026-04-22T11:45:00.000Z'),
      Date.parse('2026-04-22T11:30:00.000Z'),
      '2026-04-22T11:30:00.000Z',
      'not-a-date',
      null,
    ]);

    expect(result.map((value) => value.toISOString())).toEqual([
      '2026-04-22T11:45:00.000Z',
      '2026-04-22T11:30:00.000Z',
      '2026-04-22T11:15:00.000Z',
    ]);
  });

  it('keeps only the newest requested number of waves', () => {
    const result = getRetainedWaveEndTimes(
      [
        '2026-04-22T11:00:00.000Z',
        '2026-04-22T11:15:00.000Z',
        '2026-04-22T11:30:00.000Z',
        '2026-04-22T11:45:00.000Z',
      ],
      3,
    );

    expect(result.map((value) => value.toISOString())).toEqual([
      '2026-04-22T11:45:00.000Z',
      '2026-04-22T11:30:00.000Z',
      '2026-04-22T11:15:00.000Z',
    ]);
  });

  it('returns the oldest retained wave as the delete cutoff', () => {
    const result = getWaveRetentionCutoff(
      [
        '2026-04-22T11:00:00.000Z',
        '2026-04-22T11:15:00.000Z',
        '2026-04-22T11:30:00.000Z',
        '2026-04-22T11:45:00.000Z',
      ],
      3,
    );

    expect(result?.toISOString()).toBe('2026-04-22T11:15:00.000Z');
  });

  it('rejects invalid keep counts', () => {
    expect(() => getRetainedWaveEndTimes([], 0)).toThrow(/positive integer/);
  });
});
