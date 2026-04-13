import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { ethers } from 'ethers';

import { env } from '../../env.js';
import { fetchRawFills } from '../../utils/fetch-raw-fills.js';
import { bytes32ToField2DecStrings } from '../../utils/bytes32-to-field2-dec-strings.js';
import { hexToFixedBytes } from '../../utils/hex-to-fixed-bytes.js';
import { padRawFills } from '../../utils/pad-raw-fills.js';
import { attestHyperliquidUserFills } from '../../zk-tls/attest-hyperliquid.js';
import { getFillsCommitment } from '../../zk-tls/get-fills-commitment.js';
import type { NoirCircuitInput } from '../types.js';

export interface ZkTLSProcessorInput {
  startTime: number;
  endTime: number;
  proofType?: string;
  baseBalance: number;
  threshold: number;
}

// Singleton so ethers tracks nonce internally across tasks
let primusInstance: PrimusNetwork | null = null;

async function getPrimus(): Promise<PrimusNetwork> {
  if (primusInstance) return primusInstance;

  const provider = new ethers.providers.JsonRpcProvider(env.RPC_URL);
  const wallet = new ethers.Wallet(env.PRIMUS_PRIVATE_KEY, provider);

  const primus = new PrimusNetwork();
  await primus.init(wallet, env.PRIMUS_CHAIN_ID);
  primusInstance = primus;
  return primus;
}

export async function runZkTLSProcessor(input: ZkTLSProcessorInput): Promise<NoirCircuitInput> {
  const { startTime, endTime, baseBalance, threshold } = input;

  const CHAIN_ID = env.PRIMUS_CHAIN_ID;
  const apiUrl = env.BINANCE_API_URL;
  const apiKey = env.BINANCE_API_KEY;
  const apiSecret = env.BINANCE_API_SECRET;
  const symbol = env.BINANCE_SYMBOL;

  const primus = await getPrimus();
  const rawfillsResponse = await fetchRawFills(apiUrl, apiKey, apiSecret, symbol, startTime, endTime);
  const zktlsVerifiedResult = await attestHyperliquidUserFills(
    primus,
    CHAIN_ID,
    symbol,
    startTime,
    endTime,
  );
  const fillsCommitment = getFillsCommitment(zktlsVerifiedResult);
  const fillsCommitmentBytes = hexToFixedBytes(fillsCommitment, 32);
  const fillsCommitmentField2 = bytes32ToField2DecStrings(fillsCommitmentBytes);
  const rawFillsPadded = padRawFills(rawfillsResponse);

  return {
    fillsCommitment: fillsCommitmentField2,
    rawFills: rawFillsPadded.padded,
    rawFillsLength: rawFillsPadded.length,
    startTime,
    endTime,
    baseBalance,
    threshold,
  };
}
