export interface VerifiedHyperliquidAttestation {
  taskId: string;
  reportTxHash: string;
  attestor: string;
  recipient: string;
  chainId: number;
  addressCommitment: string;
  fillsCommitment: string;
  verifiedResult: unknown;
}

export interface HyperliquidWitness {
  userAddress: string;
  salt: string;
}
