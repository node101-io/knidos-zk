import "dotenv/config";

import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";
import fs from "fs";

import { fetchHyperliquidFills } from "./utils/fetchHyperliquidFills.js";
import { requireEnv } from "./utils/requireEnv.js";
import { attestHyperliquidUserFills } from "../zktls/attestHyperliquid.js";
import { sha256Raw } from "./utils/hashRawResponse.js";
import { getFillsCommitment } from "../zktls/commitments/fillsCommitment.js";
import { hexToFixedBytes } from "./utils/hexToFixedBytes.js";
import { padRawFills } from "./utils/padRawFills.js";
import { bytes32ToField2DecStrings } from "./utils/addressCommitmentFieldTwo.js";

const END_TIME = 1769172996000;
const START_TIME = 1769172979000;

async function main(): Promise<void> {
  const PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY");
  const BINANCE_API_KEY = requireEnv("BINANCE_API_KEY");
  const BINANCE_API_SECRET = requireEnv("BINANCE_API_SECRET");
  const symbol = process.env.BINANCE_SYMBOL ?? "BTCUSDT";

  const CHAIN_ID: number = +requireEnv("PRIMUS_CHAIN_ID");
  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

  const apiUrl = requireEnv("BINANCE_API_URL");

  const _rawfillsResponse = await fetchHyperliquidFills(apiUrl, BINANCE_API_KEY, BINANCE_API_SECRET, symbol, START_TIME, END_TIME);

  const rawfillsResponseHash = sha256Raw(_rawfillsResponse!);
  const zktlsVerifiedResult = await attestHyperliquidUserFills(primus, CHAIN_ID, symbol, START_TIME, END_TIME);

  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);

  const decoder = new TextDecoder("utf-8");
  console.log(decoder.decode(_rawfillsResponse!));
  // For debugging purposes
  console.log("Raw Fills Response Hash: " + rawfillsResponseHash);
  console.log("Verified Result: " + JSON.stringify(zktlsVerifiedResult));
  console.log("Fills Commitment: " + fillsCommitment);
  console.log(_rawfillsResponse);

  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);
  const fillsCommitmentField2 = bytes32ToField2DecStrings(fillsCommitmentBytes);

  const rawFillsPadded = padRawFills(_rawfillsResponse!);
  const rawFillsBytes = rawFillsPadded.padded;
  const rawFillsLength = rawFillsPadded.length;

  fs.writeFileSync(
    "circuit/Prover.toml",
    `
    fillsCommitment = ${JSON.stringify(fillsCommitmentField2)}
    rawFills = ${JSON.stringify(Array.from(rawFillsBytes))}
    rawFillsLength = ${rawFillsLength}
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
