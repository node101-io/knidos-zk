import "dotenv/config";
import fs from "fs";
import { zkVerifySession, ZkVerifyEvents, UltrahonkVariant } from "zkverifyjs";

const proof = fs.readFileSync("./target/zkv_proof.hex", "utf-8");
const publicInputs = fs.readFileSync("./target/zkv_pubs.hex", "utf-8");
const vk = fs.readFileSync("./target/zkv_vk.hex", "utf-8");

function chunkHexToBytes32List(hexStr) {
  const stripped = hexStr.trim().startsWith("0x") ? hexStr.trim().slice(2) : hexStr.trim();
  if (stripped.length % 64 !== 0) {
    throw new Error(
      `Invalid public inputs: hex length ${stripped.length} is not a multiple of 64 (bytes32).`
    );
  }
  const result = [];
  for (let i = 0; i < stripped.length; i += 64) {
    result.push("0x" + stripped.slice(i, i + 64));
  }
  return result;
}

function parsePublicSignalsFile(content) {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  if (lines.length === 1) {
    // Single line that may contain multiple concatenated field elements
    return chunkHexToBytes32List(lines[0]);
  }

  // Multiple lines: ensure each is bytes32, chunk if necessary
  const parts = [];
  for (const line of lines) {
    const normalized = line.startsWith("0x") ? line : `0x${line}`;
    const hexLen = normalized.length - 2;
    if (hexLen === 64) {
      parts.push(normalized);
    } else {
      parts.push(...chunkHexToBytes32List(normalized));
    }
  }
  return parts;
}

async function main() {
  const session = await zkVerifySession
    .start()
    // .Volta() // Testnet
    .zkVerify()  // Mainnet
    .withAccount(process.env.SEED_PHRASE);

  let statement, aggregationId;

  session.subscribe([
    {
      event: ZkVerifyEvents.NewAggregationReceipt,
      callback: async (eventData) => {
        console.log("New aggregation receipt:", eventData);
        if (
          aggregationId ==
          parseInt(eventData.data.aggregationId.replace(/,/g, ""))
        ) {
          let statementpath = await session.getAggregateStatementPath(
            eventData.blockHash,
            parseInt(eventData.data.domainId),
            parseInt(eventData.data.aggregationId.replace(/,/g, "")),
            statement
          );
          console.log("Statement path:", statementpath);
          const statementproof = {
            ...statementpath,
            domainId: parseInt(eventData.data.domainId),
            aggregationId: parseInt(
              eventData.data.aggregationId.replace(/,/g, "")
            ),
          };
          fs.writeFileSync("./aggregation.json", JSON.stringify(statementproof));
        }
      },
      options: { domainId: 0 },
    },
  ]);

  const { events } = await session
    .verify()
    .ultrahonk({
      variant: UltrahonkVariant.ZK
    })
    .execute({
      proofData: {
        vk: vk.split("\n")[0],
        proof: proof.split("\n")[0],
        publicSignals: parsePublicSignalsFile(publicInputs),
      },
      domainId: 0,
    });

  events.on(ZkVerifyEvents.IncludedInBlock, (eventData) => {
    console.log("Included in block", eventData);
    statement = eventData.statement;
    aggregationId = eventData.aggregationId;
    process.exit(0);
  })
}

main();
