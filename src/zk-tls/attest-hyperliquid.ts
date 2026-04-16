import { createHmac } from 'crypto';

import { PrimusNetwork } from '@primuslabs/network-core-sdk';

import { env } from '../env.js';
import type { VerifiedHyperliquidAttestation } from './types.js';

export const TASK_TIMEOUT_MS = 900_000;

export interface PrimusSubmit {
  taskId: string;
  taskTxHash: string;
  taskAttestors: string[];
  submittedAt: number;
}

export interface PrimusAttest {
  reportTxHash: string;
}

export interface PrimusCheckpoint {
  submit: PrimusSubmit;
  attest?: PrimusAttest;
  verified?: VerifiedHyperliquidAttestation;
}

export async function primusSubmit(primus: PrimusNetwork): Promise<PrimusSubmit> {
  const result = (await primus.submitTask({
    address: env.PRIMUS_USER_ADDRESS,
  })) as { taskId: string; taskTxHash: string; taskAttestors: string[] };

  return {
    taskId: result.taskId,
    taskTxHash: result.taskTxHash,
    taskAttestors: result.taskAttestors,
    submittedAt: Date.now(),
  };
}

export async function primusAttest(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<PrimusAttest> {
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTime),
    endTime: String(endTime),
    recvWindow: '60000',
    timestamp: String(timestamp),
  }).toString();
  const signature = createHmac('sha256', env.BINANCE_API_SECRET).update(queryString).digest('hex');
  const url = `${env.BINANCE_API_URL}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

  const result = await primus.attest({
    address: env.PRIMUS_USER_ADDRESS,
    taskId: submit.taskId,
    taskTxHash: submit.taskTxHash,
    taskAttestors: submit.taskAttestors,
    requests: [
      {
        url,
        method: 'GET',
        header: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
        body: {},
      },
    ],
    responseResolves: [
      [
        {
          keyName: 'fills_commitment',
          parseType: 'json',
          parsePath: '$',
          op: 'SHA256',
        },
      ],
    ],
    extendedParams: JSON.stringify({ attUrlOptimization: true }),
    getAllJsonResponse: 'true',
    attMode: { algorithmType: 'mpctls', resultType: 'plain' },
  });

  const reportTxHash = result[0]?.reportTxHash;
  if (!reportTxHash) {
    throw new Error('attestation_report_missing');
  }
  return { reportTxHash };
}

export async function primusVerify(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  attest: PrimusAttest,
  chainId: number,
): Promise<VerifiedHyperliquidAttestation> {
  const raw = await primus.verifyAndPollTaskResult({
    taskId: submit.taskId,
    reportTxHash: attest.reportTxHash,
  });

  const verified = raw[0];
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

  return {
    taskId: submit.taskId,
    reportTxHash: attest.reportTxHash,
    attestor: verified.attestor,
    recipient: attestation.recipient,
    chainId,
    fillsCommitment,
    verifiedResult: JSON.stringify(raw),
  };
}
