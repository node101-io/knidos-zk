import { describe, expect, it } from 'vitest';

import { getSuccessMonitorPolicy } from '../src/services/success-monitor-policy.js';

describe('success monitor policy', () => {
  it('uses two scheduler windows and requires one proof per window', () => {
    expect(getSuccessMonitorPolicy(360)).toEqual({
      lookbackMinutes: 720,
      lookbackMs: 43_200_000,
      minimumSuccess: 1,
    });
  });

  it('tracks scheduler configuration changes', () => {
    expect(getSuccessMonitorPolicy(60)).toEqual({
      lookbackMinutes: 120,
      lookbackMs: 7_200_000,
      minimumSuccess: 1,
    });
  });
});
