import "dotenv/config";
import fs from "fs";
import { zkVerifySession, UltrahonkVariant } from "zkverifyjs";
import { requireEnv } from "../scripts/utils/requireEnv.js";

const proof = fs.readFileSync("../circuit/target/zkv_proof.hex", "utf-8").trim();
const publicSignals = fs.readFileSync("../circuit/target/zkv_pubs.hex", "utf-8").trim();
const vk = fs.readFileSync("../circuit/target/zkv_vk.hex", "utf-8").trim();
const seed_phrase = requireEnv("SEED_PHRASE");
const proofData = {
  proof,
  publicSignals,
  vk,
};

const session = await zkVerifySession
  .start()
  .Volta()
  .withAccount(seed_phrase);

try {
  const res = await session
    .verify()
    .ultrahonk({ variant: UltrahonkVariant.Plain })
    .execute({proofData});

  console.log("Submitted:", res);
} finally {
}