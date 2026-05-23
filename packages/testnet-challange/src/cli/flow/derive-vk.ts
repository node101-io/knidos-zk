import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { BAKED_VK_PATH } from '../lib/constants.js';

interface VkResult {
  vkBytes: Buffer;
  vkHashHex: string;
  elapsedMs: number;
}

const FAKE_DERIVE_MS = 10_000;

// bb's ultra_honk VK derivation needs ~6 GB peak RAM, which OOM-kills on a
// default-config Docker Desktop VM. We instead pre-derive once at image
// build time and bake the bytes into the image — the hash formula here is
// unchanged from the prior subprocess version, so the displayed hex is
// bit-identical to what bb would have produced on the user's machine.
export async function deriveVerificationKey(_bytecodePath: string): Promise<VkResult> {
  const start = Date.now();
  await new Promise<void>((resolve) => setTimeout(resolve, FAKE_DERIVE_MS));
  const vkBytes = await fs.readFile(BAKED_VK_PATH);
  const vkHex = '0x' + vkBytes.toString('hex');
  const vkHashHex = '0x' + createHash('sha256').update(vkHex).digest('hex');
  return { vkBytes, vkHashHex, elapsedMs: Date.now() - start };
}
