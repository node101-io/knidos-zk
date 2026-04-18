import { describe, expect, it } from 'vitest';

import { getSharedNoirRuntime } from '../src/pipelines/noir/runtime.js';

describe('Noir circuit compilation', () => {
  it('compiles the circuit and generates a verification key', async () => {
    const runtime = await getSharedNoirRuntime();
    expect(runtime.program).toBeDefined();
    expect(runtime.vk).toBeInstanceOf(Uint8Array);
    expect(runtime.vk.length).toBeGreaterThan(0);
    expect(runtime.numPublicInputs).toBe(4);
  });
});
