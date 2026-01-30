import { attestHyperliquidUserFills } from "./attestHyperliquid.ts";
import "dotenv/config";

async function main() {
  console.log("Starting zkTLS attestation");

  const result = await attestHyperliquidUserFills();

  console.log("Attestation finished");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Test failed");
  console.error(err);
  process.exit(1);
});
