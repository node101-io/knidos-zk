import { promises as fs } from 'node:fs';

import { keccak_256 } from '@noble/hashes/sha3';

import { BAKED_VK_PATH } from '../lib/constants.js';

interface VkResult {
  vkBytes: Buffer;
  vkHashHex: string;
  elapsedMs: number;
}

const FAKE_DERIVE_MS = 10_000;

// `bb write_vk -s ultra_honk --oracle_hash keccak` produces ~1760 bytes; we
// pre-derive once at image build time (~6 GB peak RAM is too heavy to push
// onto the user's Docker Desktop) and bake the bytes into the image.
//
// The hash we display matches zkverify's on-chain `statementHash` for the
// ultrahonk pallet's V0_84 variant: `keccak256( 0x00 ‖ raw_vk_bytes )`.
// The leading byte is the SCALE enum tag for `VersionedVk::V0_84`. Source:
// https://github.com/zkVerify/zkVerify/blob/main/verifiers/ultrahonk/src/lib.rs#L311-L327
export async function deriveVerificationKey(_bytecodePath: string): Promise<VkResult> {
  const start = Date.now();
  await new Promise<void>((resolve) => setTimeout(resolve, FAKE_DERIVE_MS));
  const vkBytes = await fs.readFile(BAKED_VK_PATH);
  const tagged = new Uint8Array(1 + vkBytes.length);
  tagged[0] = 0x00;
  tagged.set(vkBytes, 1);
  const vkHashHex = '0x' + Buffer.from(keccak_256(tagged)).toString('hex');
  return { vkBytes, vkHashHex, elapsedMs: Date.now() - start };
}
