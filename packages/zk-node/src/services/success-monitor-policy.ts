const MS_PER_MINUTE = 60 * 1000;

export interface SuccessMonitorPolicy {
  lookbackMinutes: number;
  lookbackMs: number;
  minimumSuccess: number;
}

// One Hyperliquid window is one proof (the response covers every coin at
// once), so a healthy pipeline shows at least one success per window. The
// lookback spans two windows to absorb the settle wait and Primus latency.
const PROOFS_PER_WINDOW = 1;

export function getSuccessMonitorPolicy(windowMinutes: number): SuccessMonitorPolicy {
  const lookbackMinutes = windowMinutes * 2;
  return {
    lookbackMinutes,
    lookbackMs: lookbackMinutes * MS_PER_MINUTE,
    minimumSuccess: PROOFS_PER_WINDOW,
  };
}
