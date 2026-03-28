import "dotenv/config";

import { PrimusNetwork } from "@primuslabs/network-core-sdk";
import { ethers } from "ethers";
import fs from "fs";

import { requireEnv } from "../../scripts/utils/requireEnv.js";
import { fetchHyperliquidFills } from "../../scripts/api/fetchHyperliquidFills.js";
import { attestHyperliquidUserFills } from "../../zktls/attestHyperliquid.js";
import { getAddressCommitment } from "../../zktls/commitments/addressCommitment.js"
import { getFillsCommitment } from "../../zktls/commitments/fillsCommitment.js";
import { getHyperliquidWitness } from "../../zktls/witness/getHyperliquidWitness.js";
import { hexToFixedBytes } from "../../scripts/utils/hexToFixedBytes.js";
import { bytes32ToField2DecStrings } from "../../scripts/utils/addressCommitmentFieldTwo.js";
import { padRawFills } from "../../scripts/utils/padRawFills.js";

export interface ZkTLSProcessorInput {
  walletAddress: string;
  startTime: number;
  endTime: number;
  proofType?: string;
  baseBalance?: number;
  threshold?: number;
  fillCount?: number;
}

export interface ZkTLSProcessorResult {
  proofType: string | null;
  taskId: string;
  rawFillsResponseHash: string;
  addressCommitment: string;
  fillsCommitment: string;
  salt: string;
  recomputedAddressHash: string;
  proverTomlPath: string;
  publicInputs: {
    startTime: number;
    endTime: number;
    fillCount: number;
    baseBalance: number;
    threshold: number;
    rawFillsLength: number;
    addressAndSaltLength: number;
  };
}

export async function runZkTLSProcessor(input: ZkTLSProcessorInput): Promise<void> {
    const {
    // walletAddress,
    startTime,
    endTime,
    // proofType,
    baseBalance,
    threshold,
  } = input;
  const startTimeMs = new Date(startTime).getTime();
  const endTimeMs = new Date(endTime).getTime();

  const PRIVATE_KEY = requireEnv("PRIMUS_PRIVATE_KEY"); //TODO: bu bilgileri db'den mi çekmeli sor
  const HYPERLIQUID_USER_ADDRESS = requireEnv("HYPERLIQUID_USER_ADDRESS");

  const CHAIN_ID: number = +requireEnv("PRIMUS_CHAIN_ID"); //TODO:ask Necip string to number
  const RPC_URL = process.env.RPC_URL ?? "https://sepolia.base.org";

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

  const apiUrl = requireEnv("HYPERLIQUID_API_URL");
  const userAddress = requireEnv("HYPERLIQUID_USER_ADDRESS");

  const rawfillsResponse = await fetchHyperliquidFills(apiUrl, userAddress, startTimeMs, endTimeMs);
  const zktlsVerifiedResult = await attestHyperliquidUserFills(primus, CHAIN_ID, startTimeMs, endTimeMs); // Public input
  const addressCommitment = getAddressCommitment(zktlsVerifiedResult);
  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);

  const hyperliquidWitness = getHyperliquidWitness(primus, zktlsVerifiedResult.taskId, HYPERLIQUID_USER_ADDRESS);
  const _salt = hyperliquidWitness.salt;

  const addressCommitmentBytes = hexToFixedBytes(addressCommitment, 32);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);

  const addressCommitmentField2 = bytes32ToField2DecStrings(addressCommitmentBytes);
  const fillsCommitmentField2   = bytes32ToField2DecStrings(fillsCommitmentBytes);
  const addressStringBytes = Buffer.from(HYPERLIQUID_USER_ADDRESS, "utf8");
  const saltBytes = hexToFixedBytes(_salt, 16);
  const rawFillsPadded = padRawFills(rawfillsResponse!);
  const rawFillsBytes = rawFillsPadded.padded;
  const rawFillsLength = rawFillsPadded.length;

  const proverTomlPath = "circuit/Prover.toml";
  fs.writeFileSync(proverTomlPath, //TODO: fillCount hesaplama fonksiyonu
    `
    address = ${JSON.stringify(Array.from(addressStringBytes))}
    salt = ${JSON.stringify(Array.from(saltBytes))}
    addressCommitment = ${JSON.stringify(addressCommitmentField2)}
    fillsCommitment = ${JSON.stringify(fillsCommitmentField2)}
    rawFills = ${JSON.stringify(Array.from(rawFillsBytes))}
    rawFillsLength = ${rawFillsLength}
    addressAndSaltLength = 58
    fillCount = 3
    startTime = ${startTime}
    endTime = ${endTime}
    baseBalance = ${baseBalance}
    threshold = ${threshold}
    `
    );
}