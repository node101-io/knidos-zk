import { fetchRawFills } from "../core/fetchRawFills.js";

import type {
  NormalizedFill,
  CallbackFills,
  RawFills
} from "../types.js";

export function fetchHyperliquidFills (apiUrl: string, userAddress: string, callback?: CallbackFills) : Promise<RawFills> | void{
  if(!callback)
    return fetchRawFills(apiUrl, userAddress);

  fetchRawFills(apiUrl, userAddress)
    .then(fills => callback(null, fills))
    .catch(err => callback(err));
  return;
}