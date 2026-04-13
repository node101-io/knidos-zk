export interface VerifiedHyperliquidAttestation {
  taskId: string;
  reportTxHash: string;
  attestor: string;
  recipient: string;
  chainId: number;
  fillsCommitment: string;
  verifiedResult: unknown;
}
