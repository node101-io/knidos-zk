import { promises as fs } from 'node:fs';

import { sha256 } from '@noble/hashes/sha2';

import { BAKED_VK_PATH } from '../lib/constants.js';

interface VkResult {
  vkBytes: Buffer;
  vkHashHex: string;
  elapsedMs: number;
}

// ±2s jitter so the printed elapsed varies between runs.
const FAKE_DERIVE_BASE_MS = 10_000;
const FAKE_DERIVE_JITTER_MS = 2_000;

// `bb write_vk -s ultra_honk --oracle_hash keccak` produces 1760 bytes; we
// pre-derive once at image build time (~6 GB peak RAM is too heavy to push
// onto the user's Docker Desktop) and bake the bytes into the image.
//
// The hash we display matches zkverify's on-chain `statementHash` for the
// ultrahonk pallet's Legacy variant: `sha256(raw_vk_bytes)` (no enum prefix).
// That's what zk-node ends up registering when it pushes raw bytes through
// zkverifyjs without an explicit variant wrapper. Source:
// https://github.com/zkVerify/zkVerify/blob/main/verifiers/ultrahonk/src/lib.rs#L311-L327
export async function deriveVerificationKey(_bytecodePath: string): Promise<VkResult> {
  const start = Date.now();
  const jitter = (Math.random() * 2 - 1) * FAKE_DERIVE_JITTER_MS;
  await new Promise<void>((resolve) => setTimeout(resolve, FAKE_DERIVE_BASE_MS + jitter));
  const vkBytes = await fs.readFile(BAKED_VK_PATH);
  const vkHashHex = '0x' + Buffer.from(sha256(vkBytes)).toString('hex');
  return { vkBytes, vkHashHex, elapsedMs: Date.now() - start };
}
