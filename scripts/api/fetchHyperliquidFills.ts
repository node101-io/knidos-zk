import { fetchAndNormalizeFills } from "../core/fetchAndNormalizeFills";
import {
  NormalizedFill,
  CallbackFills
} from "../types";

export function fetchHyperliquidFills (apiUrl: string, userAddress: string, callback?: CallbackFills) : Promise<NormalizedFill[]> | void {
  if(!callback)
    return fetchAndNormalizeFills(apiUrl, userAddress);

  fetchAndNormalizeFills(apiUrl, userAddress)
    .then(fills => callback(null, fills))
    .catch(err => callback(err));
}