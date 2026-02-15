import type { VerifiedHyperliquidAttestation } from "../../scripts/types";

export function getAddressCommitment( attestation: VerifiedHyperliquidAttestation): string {
  //TODO: security check
  return attestation.addressCommitment;
}