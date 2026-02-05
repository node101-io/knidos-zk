import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

import { fetchHyperliquidFills } from "./api/fetchHyperliquidFills.ts";
import { requireEnv } from "./utils/requireEnv.ts";

async function main(): Promise<void> {
  const apiUrl = requireEnv("HYPERLIQUID_API_URL");
  const userAddress = requireEnv("HYPERLIQUID_USER_ADDRESS");
  const outputDir = requireEnv("OUTPUT_DIR");

  const fills = await fetchHyperliquidFills(apiUrl, userAddress);

  fs.mkdirSync(outputDir, { recursive: true });

  const outPath = path.join(
    outputDir,
    "hyperliquid_userfills_normalized.json"
  );

  fs.writeFileSync(
    outPath,
    JSON.stringify(fills, null, 2),
    "utf-8"
  );

}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
