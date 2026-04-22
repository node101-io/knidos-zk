import { beforeEach, describe, expect, it, vi } from 'vitest';

const primusInit = vi.fn();

vi.mock('@primuslabs/network-core-sdk', () => ({
  PrimusNetwork: vi.fn().mockImplementation(function MockPrimusNetwork(this: {
    init?: typeof primusInit;
  }) {
    this.init = primusInit;
  }),
}));

describe('createPrimusClient', () => {
  beforeEach(() => {
    primusInit.mockReset();
    vi.resetModules();
  });

  it('creates a fresh SDK instance for each call', async () => {
    const { createPrimusClient } = await import('../src/primus/client.js');

    const client = createPrimusClient({
      chainId: 84532,
      privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      rpcUrl: 'https://sepolia.base.org',
      userAddress: '0x1111111111111111111111111111111111111111',
    });

    const first = await client.sdk();
    const second = await client.sdk();

    expect(first).not.toBe(second);
    expect(primusInit).toHaveBeenCalledTimes(2);
  });
});
