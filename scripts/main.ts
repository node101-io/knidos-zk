import "dotenv/config";

import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";
import fs from "fs";
// import { createHash } from "crypto";

import { fetchHyperliquidFills } from "./api/fetchHyperliquidFills.ts";
import { requireEnv } from "./utils/requireEnv.ts";
import { attestHyperliquidUserFills } from "../zktls/attestHyperliquid.ts";
import { sha256Raw } from "./utils/hashRawResponse.ts";
// import { sha256WithSalt } from "./utils/hashAddressAndSalt.ts";
import { getAddressCommitment } from "../zktls/commitments/addressCommitment.ts"
import { getFillsCommitment } from "../zktls/commitments/fillsCommitment.ts";
import { getHyperliquidWitness } from "../zktls/witness/getHyperliquidWitness.ts";
import { hexToFixedBytes } from "./utils/hexToFixedBytes.ts";
import { padRawFills } from "./utils/padRawFills.ts";
// import { addressStringToBytes42 } from "./utils/addressStringToBytes.ts";

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

  const _rawfillsResponse = await fetchHyperliquidFills(apiUrl, userAddress);

  const rawfillsResponseHash = sha256Raw(_rawfillsResponse!); // TODO: Ask Necip
  const zktlsVerifiedResult = await attestHyperliquidUserFills(primus, CHAIN_ID); // Public input

  const addressCommitment = getAddressCommitment(zktlsVerifiedResult);
  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);

  const hyperliquidWitness = getHyperliquidWitness(primus, zktlsVerifiedResult.taskId, HYPERLIQUID_USER_ADDRESS);

  const _salt = hyperliquidWitness.salt;

  // For debugging purposes
  // console.log("Raw Fills Response Hash: " + rawfillsResponseHash);
  // console.log("Verified Result: " + JSON.stringify(zktlsVerifiedResult));
  // console.log("Address Commitment: "+ addressCommitment);
  // console.log("Fills Commitment: "+ fillsCommitment);
  // console.log("Salt: " + _salt);
  // console.log("Calculated Address hash: " + sha256WithSalt(HYPERLIQUID_USER_ADDRESS, _salt));

  const addressCommitmentBytes = hexToFixedBytes(addressCommitment, 32);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);

  const addressStringBytes = Buffer.from(HYPERLIQUID_USER_ADDRESS, "utf8");
  const saltBytes = hexToFixedBytes(_salt, 16);

  const rawFillsPadded = padRawFills(_rawfillsResponse!);
  const rawFillsBytes = rawFillsPadded.padded;
  const rawFillsLength = rawFillsPadded.length;

  // UNCOMMENT FOR DEBUGGING PURPOSES
  // const jsAddressAndSaltHash = createHash("sha256")
  //   .update(Buffer.concat([addressStringBytes, saltBytes]))
  //   .digest("hex");

  // console.log("zkTLS address commitment (hex):", addressCommitment);
  // console.log("JS recomputed address hash (hex):", jsAddressAndSaltHash);

  fs.writeFileSync(
    "circuit/Prover.toml",
    `
    address = ${JSON.stringify(Array.from(addressStringBytes))}
    salt = ${JSON.stringify(Array.from(saltBytes))}
    addressCommitment = ${JSON.stringify(Array.from(addressCommitmentBytes))}
    fillsCommitment   = ${JSON.stringify(Array.from(fillsCommitmentBytes))}
    rawFills = ${JSON.stringify(Array.from(rawFillsBytes))}
    rawFillsLength = ${rawFillsLength}
    `
  );
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
