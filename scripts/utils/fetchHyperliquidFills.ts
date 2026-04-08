import { fetchRawFills } from './fetchRawFills.js';

import type { CallbackFills, RawFills } from '../types.js';

export function fetchHyperliquidFills(
  apiUrl: string,
  userAddress: string,
  startTime: number,
  endTime: number,
  callback?: CallbackFills,
): Promise<RawFills> | void {
  if (!callback) return fetchRawFills(apiUrl, userAddress, startTime, endTime);

  fetchRawFills(apiUrl, userAddress, startTime, endTime)
    .then((fills) => callback(null, fills))
    .catch((err) => callback(err));
  return;
}
