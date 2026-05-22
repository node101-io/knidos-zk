import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BB_PATH } from '../lib/constants.js';

interface VkResult {
  vkBytes: Buffer;
  vkHashHex: string;
  elapsedMs: number;
}

// Spawn `bb write_vk` on the freshly compiled circuit bytecode. Native bb
// uses ~6 GB peak RAM and ~30 sec on a modest laptop.
export async function deriveVerificationKey(bytecodePath: string): Promise<VkResult> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knidos-vk-'));
  try {
    const start = Date.now();
    await runBb([
      'write_vk',
      '--scheme', 'ultra_honk',
      '-b', bytecodePath,
      '-o', outDir,
      '--output_format', 'bytes',
    ]);
    const vkBytes = await fs.readFile(path.join(outDir, 'vk'));
    // sha256 over the 0x-prefixed hex string of the raw VK bytes — matches the
    // convention used on zk-node side and on-chain.
    const vkHex = '0x' + vkBytes.toString('hex');
    const vkHashHex = '0x' + createHash('sha256').update(vkHex).digest('hex');
    return { vkBytes, vkHashHex, elapsedMs: Date.now() - start };
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runBb(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(BB_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`bb exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}
