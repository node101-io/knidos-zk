import { describe, expect, it } from 'vitest';

import { getSuccessMonitorPolicy } from '../src/services/success-monitor-policy.js';

describe('success monitor policy', () => {
  it('uses two scheduler windows and requires one complete symbol wave', () => {
    expect(getSuccessMonitorPolicy(360, 6)).toEqual({
      lookbackMinutes: 720,
      lookbackMs: 43_200_000,
      minimumSuccess: 6,
    });
  });

  it('tracks scheduler and symbol configuration changes', () => {
    expect(getSuccessMonitorPolicy(60, 3)).toEqual({
      lookbackMinutes: 120,
      lookbackMs: 7_200_000,
      minimumSuccess: 3,
    });
  });
});
