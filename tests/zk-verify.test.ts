import { describe, expect, inject, it } from 'vitest';

import { runZkVerifyProcessor } from '../src/pipelines/zk-verify/processor.js';

describe('zkVerify submission', () => {
  const proof = inject('noirProof');
  const run = proof ? it : it.skip;

  run('submits proof and gets block inclusion', async () => {
    const result = await runZkVerifyProcessor({
      vk: proof!.vkHex,
      proof: proof!.proofHex,
      publicSignals: proof!.publicInputs,
    });

    expect(result.includedInBlock).toBeDefined();
  });
});
