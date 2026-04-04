import "dotenv/config";

import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";
import fs from "fs";
import { createHash } from "crypto";

import { fetchHyperliquidFills } from "./api/fetchHyperliquidFills.js";
import { requireEnv } from "./utils/requireEnv.js";
import { attestHyperliquidUserFills } from "../zktls/attestHyperliquid.js";
import { sha256Raw } from "./utils/hashRawResponse.js";
import { sha256WithSalt } from "./utils/hashAddressAndSalt.js";
import { getAddressCommitment } from "../zktls/commitments/addressCommitment.js"
import { getFillsCommitment } from "../zktls/commitments/fillsCommitment.js";
import { getHyperliquidWitness } from "../zktls/witness/getHyperliquidWitness.js";
import { hexToFixedBytes } from "./utils/hexToFixedBytes.js";
import { padRawFills } from "./utils/padRawFills.js";
import { bytes32ToField2DecStrings } from "./utils/addressCommitmentFieldTwo.js";
// import { addressStringToBytes42 } from "./utils/addressStringToBytes.js";
// const now = new Date();
// const  END_TIME= now.getTime(); // Hardcoded
// const   START_TIME = now.getTime() - 15 * 60 * 1000;

const  END_TIME=1769172996000;
const   START_TIME = 1769172979000;
async function main(): Promise<void> {
  const PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY");
  const HYPERLIQUID_USER_ADDRESS = requireEnv("HYPERLIQUID_USER_ADDRESS");

  const CHAIN_ID: number = +requireEnv("PRIMUS_CHAIN_ID"); //TODO:ask Necip string to number
  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

  const apiUrl = requireEnv("HYPERLIQUID_API_URL");
  const userAddress = requireEnv("HYPERLIQUID_USER_ADDRESS");

  const _rawfillsResponse = await fetchHyperliquidFills(apiUrl, userAddress, START_TIME, END_TIME);

  const rawfillsResponseHash = sha256Raw(_rawfillsResponse!); // TODO: Ask Necip
  const zktlsVerifiedResult = await attestHyperliquidUserFills(primus, CHAIN_ID, START_TIME, END_TIME); // Public input

  const addressCommitment = getAddressCommitment(zktlsVerifiedResult);
  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);

  const hyperliquidWitness = getHyperliquidWitness(primus, zktlsVerifiedResult.taskId, HYPERLIQUID_USER_ADDRESS);

  const _salt = hyperliquidWitness.salt;
  const decoder = new TextDecoder("utf-8");
  console.log(decoder.decode(_rawfillsResponse!));
  // For debugging purposes
  console.log("Raw Fills Response Hash: " + rawfillsResponseHash);
  console.log("Verified Result: " + JSON.stringify(zktlsVerifiedResult));
  console.log("Address Commitment: "+ addressCommitment);
  console.log("Fills Commitment: "+ fillsCommitment);
  console.log("Salt: " + _salt);
  console.log("Calculated Address hash: " + sha256WithSalt(HYPERLIQUID_USER_ADDRESS, _salt));

  const addressCommitmentBytes = hexToFixedBytes(addressCommitment, 32);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);

  const addressCommitmentField2 = bytes32ToField2DecStrings(addressCommitmentBytes);
  const fillsCommitmentField2   = bytes32ToField2DecStrings(fillsCommitmentBytes);

  const addressStringBytes = Buffer.from(HYPERLIQUID_USER_ADDRESS, "utf8");
  const saltBytes = hexToFixedBytes(_salt, 16);
  console.log(_rawfillsResponse);
  const rawFillsPadded = padRawFills(_rawfillsResponse!);
  const rawFillsBytes = rawFillsPadded.padded;
  const rawFillsLength = rawFillsPadded.length;

  // UNCOMMENT FOR DEBUGGING PURPOSES
  const jsAddressAndSaltHash = createHash("sha256")
    .update(Buffer.concat([addressStringBytes, saltBytes]))
    .digest("hex");

  console.log("zkTLS address commitment (hex):", addressCommitment);
  console.log("JS recomputed address hash (hex):", jsAddressAndSaltHash);

  fs.writeFileSync(
    "circuit/Prover.toml",
    `
    address = ${JSON.stringify(Array.from(addressStringBytes))}
    salt = ${JSON.stringify(Array.from(saltBytes))}
    addressCommitment = ${JSON.stringify(addressCommitmentField2)}
    fillsCommitment   = ${JSON.stringify(fillsCommitmentField2)}
    rawFills = ${JSON.stringify(Array.from(rawFillsBytes))}
    rawFillsLength = ${rawFillsLength}
    addressAndSaltLength = 58
    fillCount = 3
    startTime = ${START_TIME}
    endTime = ${END_TIME}
    baseBalance = 100000000
    threshold = 50000000
    `
  );
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
