import { createHmac } from 'crypto';

import { PrimusNetwork } from '@primuslabs/network-core-sdk';

import { env } from '../env.js';
import type { VerifiedHyperliquidAttestation } from './types.js';

export async function attestHyperliquidUserFills(
  primus: PrimusNetwork,
  CHAIN_ID: number,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<VerifiedHyperliquidAttestation> {
  const PRIMUS_USER_ADDRESS = env.PRIMUS_USER_ADDRESS;
  const BINANCE_API_URL = env.BINANCE_API_URL;
  const BINANCE_API_KEY = env.BINANCE_API_KEY;
  const BINANCE_API_SECRET = env.BINANCE_API_SECRET;
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTime),
    endTime: String(endTime),
    recvWindow: '60000',
    timestamp: String(timestamp),
  }).toString();
  const signature = createHmac('sha256', BINANCE_API_SECRET).update(queryString).digest('hex');
  const url = `${BINANCE_API_URL}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

  const requests = [
    {
      url,
      method: 'GET',
      header: {
        'X-MBX-APIKEY': BINANCE_API_KEY,
      },
      body: {},
    },
  ];

  const responseResolves = [
    [
      {
        keyName: 'fills_commitment',
        parseType: 'json',
        parsePath: '$',
        op: 'SHA256',
      },
    ],
  ];

  const submitTaskResult = await primus.submitTask({
    address: PRIMUS_USER_ADDRESS,
  });

  const { taskId, taskTxHash, taskAttestors } = submitTaskResult as {
    taskId: string;
    taskTxHash: string;
    taskAttestors: string[];
  };
  const attestResult = await primus.attest({
    address: PRIMUS_USER_ADDRESS,
    taskId,
    taskTxHash,
    taskAttestors,
    requests,
    responseResolves,
    extendedParams: JSON.stringify({ attUrlOptimization: true }),
    getAllJsonResponse: 'true',
    attMode: {
      algorithmType: 'mpctls',
      resultType: 'plain',
    },
  });

  const firstAttestResult = attestResult[0];
  if (!firstAttestResult?.reportTxHash) {
    throw new Error('attestation_report_missing');
  }
  const reportTxHash = firstAttestResult.reportTxHash;

  const verifiedResultraw = await primus.verifyAndPollTaskResult({
    taskId,
    reportTxHash,
  });

  const verified = verifiedResultraw[0];
  if (!verified) {
    throw new Error('verified_result_missing');
  }

  const attestation = verified.attestation;
  if (typeof attestation.data !== 'string') {
    throw new Error('invalid_attestation_payload');
  }

  const attData = JSON.parse(attestation.data) as Record<string, unknown>;
  const fillsCommitment = attData['SHA256($)'];

  if (typeof fillsCommitment !== 'string') {
    throw new Error('invalid_fills_commitment');
  }

  const verifiedHyperliquidAttestationResult = {
    taskId,
    reportTxHash,
    attestor: verified.attestor,
    recipient: attestation.recipient,
    chainId: CHAIN_ID,

    fillsCommitment,

    verifiedResult: JSON.stringify(verifiedResultraw, null),
  };

  return verifiedHyperliquidAttestationResult;
}
