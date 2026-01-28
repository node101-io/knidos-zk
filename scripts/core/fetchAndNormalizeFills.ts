import axios from "axios";

import type {
  UserFill,
  NormalizedFill
} from "../types";

import { normalizeFill } from "../utils/normalizeFills";
import { stableSort } from "../utils/stableSort";

const TIMEOUT = 30_000;

export async function fetchAndNormalizeFills (apiUrl: string, userAddress: string) : Promise<NormalizedFill[]> {
  const body = {
    type: "userFills",
    user: userAddress,
  };

  const response = await axios.post(apiUrl, body , {
    headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
    },
    timeout:TIMEOUT,
  })

  if (!Array.isArray(response.data)) {
    throw new Error("bad_request");
  }
  const rawFills: UserFill[] = response.data;
  const normalizedFills: NormalizedFill[] = rawFills.map(normalizeFill);
  const sortedNormalizedFills: NormalizedFill[]= stableSort(normalizedFills);

  return sortedNormalizedFills;
}