import { ZkTlsMaster } from "./masters/zkTLS";
import { NoirMaster } from "./masters/noir";
import { ZkVerifyMaster } from "./masters/zkVerify";

import "./workers/zkTLS";
import "./workers/noir";
import "./workers/zkVerify";

async function main() {
  const zktlsMaster = new ZkTlsMaster();
  const noirMaster = new NoirMaster();
  const zkverifyMaster = new ZkVerifyMaster();

  await noirMaster.init();
  await zkverifyMaster.init();

  await zktlsMaster.createTask({
    pipelineRunId: `run-${Date.now()}`,
    proofType: "hyperliquid-fills-hourly",
    walletAddress: "0x1234567890abcdef",
    timeWindowStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    timeWindowEnd: new Date().toISOString(),
  });

  console.log("[app] initial task created");
}

main().catch((err) => {
  // recover -> processing to task
  console.error("[app] fatal error", err);
  process.exit(1);
});