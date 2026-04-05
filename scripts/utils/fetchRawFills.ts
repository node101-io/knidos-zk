import axios from "axios"
import { createHmac } from "crypto"
import "dotenv/config";

import type { RawFills } from "../types.js"

const TIMEOUT = 30_000;

export async function fetchRawFills (apiUrl: string, apiKey: string, apiSecret: string, symbol: string, startTime: number, endTime: number) : Promise<RawFills> {
  const timestamp = Date.now();
  const queryString = `symbol=${symbol}&startTime=${startTime}&endTime=${endTime}&recvWindow=60000&timestamp=${timestamp}`;
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');

  const url = `${apiUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

  const response = await axios.get(url, {
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Accept": "application/json",
    },
    timeout: TIMEOUT,
    responseType: "arraybuffer",
    transformResponse: r => r,
  });

  const rawBuffer = new Uint8Array(response.data);
  return rawBuffer;
}
