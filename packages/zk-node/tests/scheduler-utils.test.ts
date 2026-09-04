import { describe, expect, it } from 'vitest';

import {
  ZKTLS_WINDOW_MS,
  getSchedulerCronExpression,
  getWindowBounds,
  getWindowBoundsFromEnd,
  getWindowsToEnsure,
} from '../src/services/scheduler-utils.js';

describe('scheduler-utils', () => {
  it('computes the previous aligned window from wall-clock time', () => {
    const now = Date.UTC(2026, 3, 13, 10, 37, 12, 987);

    const result = getWindowBounds(now);

    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.endTime.getTime()).toBe(result.startTime.getTime() + ZKTLS_WINDOW_MS);
    expect(result.endTime.getTime()).toBeLessThanOrEqual(now);
    expect(result.endTime.getTime() % ZKTLS_WINDOW_MS).toBe(0);
  });

  it('computes a window from an aligned end time', () => {
    const endTime = Date.UTC(2026, 3, 13, 11, 0, 0, 0);

    const result = getWindowBoundsFromEnd(endTime);

    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.startTime.getTime()).toBe(endTime - ZKTLS_WINDOW_MS);
    expect(result.endTime.getTime()).toBe(endTime);
  });

  it('returns only the current window when there is no previous task', () => {
    const currentWindowEnd = new Date(Date.UTC(2026, 3, 13, 11, 0, 0, 0));

    const windows = getWindowsToEnsure(null, currentWindowEnd);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.startTime.getTime()).toBe(currentWindowEnd.getTime() - ZKTLS_WINDOW_MS);
    expect(windows[0]?.endTime.getTime()).toBe(currentWindowEnd.getTime());
  });

  it('returns every missing window including the latest partial window', () => {
    const latestEndTime = new Date(Date.UTC(2026, 3, 13, 11, 0, 0, 0));
    const currentWindowEnd = new Date(latestEndTime.getTime() + 2 * ZKTLS_WINDOW_MS);

    const windows = getWindowsToEnsure(latestEndTime, currentWindowEnd);

    expect(windows).toHaveLength(3);
    expect(windows.map((window) => window.endTime.getTime())).toEqual([
      latestEndTime.getTime(),
      latestEndTime.getTime() + ZKTLS_WINDOW_MS,
      latestEndTime.getTime() + 2 * ZKTLS_WINDOW_MS,
    ]);
  });

  it('returns only the current window when already up to date', () => {
    const latestEndTime = new Date(Date.UTC(2026, 3, 13, 11, 0, 0, 0));
    const currentWindowEnd = new Date(Date.UTC(2026, 3, 13, 11, 0, 0, 0));

    const windows = getWindowsToEnsure(latestEndTime, currentWindowEnd);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.endTime.getTime()).toBe(Date.UTC(2026, 3, 13, 11, 0, 0, 0));
  });

  it('builds minute-based cron expressions for sub-hour windows', () => {
    expect(getSchedulerCronExpression(15)).toBe('*/15 * * * *');
  });

  it('builds hour-based cron expressions for multi-hour windows', () => {
    expect(getSchedulerCronExpression(60)).toBe('0 * * * *');
    expect(getSchedulerCronExpression(360)).toBe('0 */6 * * *');
    expect(getSchedulerCronExpression(1440)).toBe('0 0 * * *');
  });
});
