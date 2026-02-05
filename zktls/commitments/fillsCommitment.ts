import type { VerifiedHyperliquidAttestation } from "../../scripts/types";

export function getFillsCommitment( attestation: VerifiedHyperliquidAttestation): string {
  //TODO: security check
  return attestation.fillsCommitment;
}