import type { VerifiedHyperliquidAttestation } from './types.js';

export function getAddressCommitment(attestation: VerifiedHyperliquidAttestation): string {
  // TODO: security check
  return attestation.addressCommitment;
}
