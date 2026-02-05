import "dotenv/config";

import { fetchHyperliquidFills } from "./api/fetchHyperliquidFills.ts";
import { requireEnv } from "./utils/requireEnv.ts";
import { attestHyperliquidUserFills } from "../zktls/attestHyperliquid.ts";
import { sha256Raw } from "./utils/hashRawResponse.ts";

async function main(): Promise<void> {
  const apiUrl = requireEnv("HYPERLIQUID_API_URL");
  const userAddress = requireEnv("HYPERLIQUID_USER_ADDRESS");

  const RawfillsResponse = await fetchHyperliquidFills(apiUrl, userAddress);

  const fillsHash = sha256Raw(RawfillsResponse!); // TODO: Ask Necip
  const zktlsVerifiedResult = await attestHyperliquidUserFills(); // Public input



}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
