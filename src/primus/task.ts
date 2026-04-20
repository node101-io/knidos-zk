import { createHmac } from 'crypto';

import { PrimusNetwork } from '@primuslabs/network-core-sdk';

import { env } from '../env.js';

export interface PrimusSubmit {
  taskId: string;
  taskTxHash: string;
  taskAttestors: string[];
  submittedAt: number;
}

export interface PrimusAttest {
  reportTxHash: string;
}

// What we persist in the task doc between worker runs. `attest` is
// optional because the crash boundary might land between submit and
// attest; `verify` is not checkpointed because it is idempotent and
// cheap — re-running it on resume reads the already-mined on-chain
// result.
export interface PrimusCheckpoint {
  submit: PrimusSubmit;
  attest?: PrimusAttest;
}

export async function submitPrimusTaskRaw(primus: PrimusNetwork): Promise<PrimusSubmit> {
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

export async function attestPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  symbol: string,
  startTimeMs: number,
  endTimeMs: number,
): Promise<PrimusAttest> {
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTimeMs),
    endTime: String(endTimeMs),
    recvWindow: '60000',
    timestamp: String(Date.now()),
  }).toString();
  const signature = createHmac('sha256', env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  const result = await primus.attest({
    address: env.PRIMUS_USER_ADDRESS,
    taskId: submit.taskId,
    taskTxHash: submit.taskTxHash,
    taskAttestors: submit.taskAttestors,
    requests: [
      {
        url: `${env.BINANCE_API_URL}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
        method: 'GET',
        header: { 'X-MBX-APIKEY': env.BINANCE_API_KEY },
        body: {},
      },
    ],
    responseResolves: [
      [{ keyName: 'fills_commitment', parseType: 'json', parsePath: '$', op: 'SHA256' }],
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

// Returns the on-chain-verified fillsCommitment (SHA256 of the Binance
// response body). Everything else the attestor signs about the task is
// already captured in the task contract's on-chain state; we only read
// the one piece Noir needs.
export async function verifyPrimusTask(
  primus: PrimusNetwork,
  submit: PrimusSubmit,
  attest: PrimusAttest,
): Promise<string> {
  const raw = await primus.verifyAndPollTaskResult({
    taskId: submit.taskId,
    reportTxHash: attest.reportTxHash,
  });

  const verified = raw[0];
  if (!verified) throw new Error('verified_result_missing');

  const attestation = verified.attestation;
  if (typeof attestation.data !== 'string') throw new Error('invalid_attestation_payload');

  const attData = JSON.parse(attestation.data) as Record<string, unknown>;
  const fillsCommitment = attData['SHA256($)'];
  if (typeof fillsCommitment !== 'string') throw new Error('invalid_fills_commitment');

  return fillsCommitment;
}
