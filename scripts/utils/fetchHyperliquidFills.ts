import { fetchRawFills } from "./fetchRawFills.js";

import type {
  CallbackFills,
  RawFills
} from "../types.js";

export function fetchHyperliquidFills (apiUrl: string, apiKey: string, apiSecret: string, symbol: string, startTime: number, endTime: number, callback?: CallbackFills) : Promise<RawFills> | void{
  if(!callback)
    return fetchRawFills(apiUrl, apiKey, apiSecret, symbol, startTime, endTime);

  fetchRawFills(apiUrl, apiKey, apiSecret, symbol, startTime, endTime)
    .then(fills => callback(null, fills))
    .catch(err => callback(err));
  return;
}