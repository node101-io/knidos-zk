import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { ethers } from 'ethers';

import { env } from '../../env.js';
import { fetchRawFills } from '../../utils/fetch-raw-fills.js';
import { bytes32ToField2DecStrings } from '../../utils/bytes32-to-field2-dec-strings.js';
import { hexToFixedBytes } from '../../utils/hex-to-fixed-bytes.js';
import { padRawFills } from '../../utils/pad-raw-fills.js';
import { attestHyperliquidUserFills } from '../../zk-tls/attest-hyperliquid.js';
import { getAddressCommitment } from '../../zk-tls/get-address-commitment.js';
import { getFillsCommitment } from '../../zk-tls/get-fills-commitment.js';
import { getHyperliquidWitness } from '../../zk-tls/get-hyperliquid-witness.js';

export interface ZkTLSProcessorInput {
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

export async function runZkTLSProcessor(input: ZkTLSProcessorInput): Promise<string> {
  const {
    // walletAddress,
    startTime,
    endTime,
    // proofType,
    baseBalance,
    threshold,
  } = input;

  const PRIVATE_KEY = env.PRIMUS_PRIVATE_KEY; //TODO: bu bilgileri db'den mi çekmeli sor
  const HYPERLIQUID_USER_ADDRESS = env.HYPERLIQUID_USER_ADDRESS;

  const CHAIN_ID = env.PRIMUS_CHAIN_ID;
  const RPC_URL = env.RPC_URL;

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, CHAIN_ID);

  const apiUrl = env.HYPERLIQUID_API_URL;
  const userAddress = env.HYPERLIQUID_USER_ADDRESS;

  const rawfillsResponse = await fetchRawFills(apiUrl, userAddress, startTime, endTime);
  const zktlsVerifiedResult = await attestHyperliquidUserFills(
    primus,
    CHAIN_ID,
    startTime,
    endTime,
  ); // Public input
  const addressCommitment = getAddressCommitment(zktlsVerifiedResult);
  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);

  const hyperliquidWitness = getHyperliquidWitness(
    primus,
    zktlsVerifiedResult.taskId,
    HYPERLIQUID_USER_ADDRESS,
  );
  const _salt = hyperliquidWitness.salt;

  const addressCommitmentBytes = hexToFixedBytes(addressCommitment, 32);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);

  const addressCommitmentField2 = bytes32ToField2DecStrings(addressCommitmentBytes);
  const fillsCommitmentField2 = bytes32ToField2DecStrings(fillsCommitmentBytes);
  const addressStringBytes = Buffer.from(HYPERLIQUID_USER_ADDRESS, 'utf8');
  const saltBytes = hexToFixedBytes(_salt, 16);
  const rawFillsPadded = padRawFills(rawfillsResponse);
  const rawFillsBytes = rawFillsPadded.padded;
  const rawFillsLength = rawFillsPadded.length;

  const output = `address = ${JSON.stringify(Array.from(addressStringBytes))}
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
    `;
  return output;
}
