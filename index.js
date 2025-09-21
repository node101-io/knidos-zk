import "dotenv/config";
import fs from "fs";
import { zkVerifySession, ZkVerifyEvents } from "zkverifyjs";

const proof = fs.readFileSync("./target/zkv_proof.hex", "utf-8");
const publicInputs = fs.readFileSync("./target/zkv_pubs.hex", "utf-8");
const vk = fs.readFileSync("./target/zkv_vk.hex", "utf-8");

async function main() {
  const session = await zkVerifySession
    .start()
    .Volta()
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
          fs.writeFileSync("aggregation.json", JSON.stringify(statementproof));
        }
      },
      options: { domainId: 0 },
    },
  ]);

  const { events } = await session
    .verify()
    .ultrahonk()
    .execute({
      proofData: {
        vk: vk.split("\n")[0],
        proof: proof.split("\n")[0],
        publicSignals: publicInputs.split("\n").slice(0, -1),
      },
      domainId: 0,
    });

  events.on(ZkVerifyEvents.IncludedInBlock, (eventData) => {
    console.log("Included in block", eventData);
    statement = eventData.statement;
    aggregationId = eventData.aggregationId;
  })
}

main();
