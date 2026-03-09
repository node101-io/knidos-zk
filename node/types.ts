export type ProofType = "hyperliquid-fills-hourly";

export type PipelineJobData = {
  pipelineRunId: string;
  proofType: ProofType;
  walletAddress: string;
  timeWindowStart: string;
  timeWindowEnd: string;
};

export type ZkTlsJobName = "zktls-process";
export type NoirJobName = "noir-process";
export type ZkVerifyJobName = "zkverify-process";