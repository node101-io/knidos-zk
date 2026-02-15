import axios from "axios"
import "dotenv/config";

import type { RawFills } from "../types.ts"
// import { sha256Raw } from "../utils/hashRawResponse.ts";

const TIMEOUT = 30_000;

export async function fetchRawFills (apiUrl: string, userAddress:string) : Promise<RawFills> {
  const body = {
    type: "userFills",
    user: userAddress,
  };

  const response = await axios.post(apiUrl, body, {
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    timeout:TIMEOUT,
    responseType: "arraybuffer",
    transformResponse: r => r,
  });

  const rawBuffer = new Uint8Array(response.data);
  return rawBuffer; //TODO: you can also return the metada like timestamp etc.
}