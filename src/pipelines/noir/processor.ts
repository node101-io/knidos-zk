import type { InputMap } from '@noir-lang/noir_js';

import type { NoirJobData } from '../types.js';
import { runProofPipeline } from './runtime.js';

export interface NoirProcessorResult {
  vkHex: string;
  proofHex: string;
  publicInputs: string[];
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

export async function runNoirProcessor(
  workerId: number,
  input: NoirJobData['input'],
): Promise<NoirProcessorResult> {
  const { proof, publicInputs, vk } = await runProofPipeline(
    workerId,
    input.circuitInput as unknown as InputMap,
  );

  return {
    vkHex: bytesToHex(vk),
    proofHex: bytesToHex(proof),
    publicInputs,
  };
}
