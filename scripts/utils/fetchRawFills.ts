import axios from 'axios';
import 'dotenv/config';

import type { RawFills } from '../types.js';
// import { sha256Raw } from "../utils/hashRawResponse.js";

const TIMEOUT = 30_000;

export async function fetchRawFills(
  apiUrl: string,
  userAddress: string,
  startTime: number,
  endTime: number,
): Promise<RawFills> {
  const body = {
    type: 'userFillsByTime',
    user: userAddress,
    startTime: startTime,
    endTime: endTime,
  };

  const response = await axios.post(apiUrl, body, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: TIMEOUT,
    responseType: 'arraybuffer',
    transformResponse: (r) => r,
  });

  const rawBuffer = new Uint8Array(response.data);
  return rawBuffer; //TODO: you can also return the metada like timestamp etc.
}
