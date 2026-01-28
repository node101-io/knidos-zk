import { fetchAndNormalizeFills } from "../core/fetchAndNormalizeFills.ts";
import type {
  NormalizedFill,
  CallbackFills
} from "../types.ts";

export function fetchHyperliquidFills (apiUrl: string, userAddress: string, callback?: CallbackFills) : Promise<NormalizedFill[]> | void {
  if(!callback)
    return fetchAndNormalizeFills(apiUrl, userAddress);

  fetchAndNormalizeFills(apiUrl, userAddress)
    .then(fills => callback(null, fills))
    .catch(err => callback(err));
}