import { createHash } from 'node:crypto';

// Our own identifier for a VK: hashes the hex string as we store it in Mongo.
export function computeVkHash(vk: string): string {
  return createHash('sha256').update(vk).digest('hex');
}

// zkVerify's on-chain statement hash for an ultrahonk VK registered the way we
// register it (Legacy variant, which zkverifyjs defaults to when no version is
// given): sha256 over the raw VK bytes, no enum prefix. Verified against a live
// registration on volta, and the testnet-challenge CLI relies on the same
// formula. Source:
// https://github.com/zkVerify/zkVerify/blob/main/verifiers/ultrahonk/src/lib.rs#L311-L327
export function computeStatementHash(vk: string): string {
  const raw = Buffer.from(vk.startsWith('0x') ? vk.slice(2) : vk, 'hex');
  return `0x${createHash('sha256').update(raw).digest('hex')}`;
}
