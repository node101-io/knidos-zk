import { env } from '../env.js';
import type { SupportedBinanceSymbol } from '../shared/binance-symbols.js';
import { parseDateInput, toTimestampMs } from '../shared/date-utils.js';

export const ZKTLS_WINDOW_MS = env.ZKTLS_WINDOW_MINUTES * 60 * 1000;

export interface WindowBounds {
  startTime: Date;
  endTime: Date;
}

export function getSchedulerCronExpression(windowMinutes: number): string {
  if (windowMinutes < 60) {
    return `*/${windowMinutes} * * * *`;
  }

  if (windowMinutes === 60) {
    return '0 * * * *';
  }

  if (windowMinutes === 24 * 60) {
    return '0 0 * * *';
  }

  const windowHours = windowMinutes / 60;
  return `0 */${windowHours} * * *`;
}

export function getWindowBoundsFromEnd(endTime: Date | number): WindowBounds {
  const normalizedEndTime = parseDateInput(endTime, 'endTime');
  return {
    startTime: new Date(toTimestampMs(normalizedEndTime) - ZKTLS_WINDOW_MS),
    endTime: normalizedEndTime,
  };
}

export function getWindowBounds(now: Date | number): WindowBounds {
  const normalizedNow = parseDateInput(now, 'now');
  const nowTimestamp = toTimestampMs(normalizedNow);
  const endTime = new Date(nowTimestamp - (nowTimestamp % ZKTLS_WINDOW_MS));
  return getWindowBoundsFromEnd(endTime);
}

export function getWindowsToEnsure(
  latestEndTime: Date | null,
  currentWindowEnd: Date,
): WindowBounds[] {
  const windows: WindowBounds[] = [];

  if (latestEndTime === null || toTimestampMs(latestEndTime) >= toTimestampMs(currentWindowEnd)) {
    windows.push(getWindowBoundsFromEnd(currentWindowEnd));
    return windows;
  }

  for (
    let windowEnd = toTimestampMs(latestEndTime);
    windowEnd <= toTimestampMs(currentWindowEnd);
    windowEnd += ZKTLS_WINDOW_MS
  ) {
    windows.push(getWindowBoundsFromEnd(windowEnd));
  }

  return windows;
}

export function getMissingSymbols(
  existingSymbols: Iterable<string>,
  configuredSymbols: readonly SupportedBinanceSymbol[],
): SupportedBinanceSymbol[] {
  const existingSymbolSet = new Set(existingSymbols);
  return configuredSymbols.filter((symbol) => !existingSymbolSet.has(symbol));
}
