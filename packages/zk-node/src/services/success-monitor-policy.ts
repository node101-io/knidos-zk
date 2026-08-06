const MS_PER_MINUTE = 60 * 1000;

export interface SuccessMonitorPolicy {
  lookbackMinutes: number;
  lookbackMs: number;
  minimumSuccess: number;
}

export function getSuccessMonitorPolicy(
  windowMinutes: number,
  symbolCount: number,
): SuccessMonitorPolicy {
  const lookbackMinutes = windowMinutes * 2;
  return {
    lookbackMinutes,
    lookbackMs: lookbackMinutes * MS_PER_MINUTE,
    minimumSuccess: symbolCount,
  };
}
