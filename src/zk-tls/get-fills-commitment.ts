import type { VerifiedHyperliquidAttestation } from './types.js';

export function getFillsCommitment(attestation: VerifiedHyperliquidAttestation): string {
  // TODO: security check
  return attestation.fillsCommitment;
}
