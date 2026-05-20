import type { SupportedBinanceSymbol } from '../shared/binance-symbols.js';

export const PROOF_TYPE = 'binance-fills';

export type ProofType = typeof PROOF_TYPE;

export interface PipelineJobData {
  pipelineRunId: string;
  proofType: ProofType;
  walletAddress: string;
  timeWindowStart: string;
  timeWindowEnd: string;
}

export type ZkTlsJobName = 'zktls-process';
export type NoirJobName = 'noir-process';
export type ZkVerifyJobName = 'zkverify-process';

export interface ZkTLSJobInput {
  startTime: Date;
  endTime: Date;
  symbol: SupportedBinanceSymbol;
  proofType?: ProofType;
  baseBalance: number;
  threshold: number;
}
export interface ZkTLSJobData {
  taskId: string;
  input: ZkTLSJobInput;
}

export interface NoirCircuitInput {
  fillsCommitment: string[];
  rawFills: number[];
  rawFillsLength: number;
  startTime: number;
  endTime: number;
  baseBalance: number;
  threshold: number;
}

export interface NoirJobInput {
  zkTLSTaskId: string;
  symbol: SupportedBinanceSymbol;
  startTime: Date;
  endTime: Date;
  circuitInput: NoirCircuitInput;
}

export interface NoirJobData {
  taskId: string;
  input: NoirJobInput;
}

export interface ZkVerifyJobInput {
  noirTaskId: string;
  symbol: SupportedBinanceSymbol;
  startTime: Date;
  endTime: Date;
}

export interface ZkVerifyJobData {
  taskId: string;
  input: ZkVerifyJobInput;
}
