import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providers } from 'ethers';

const primusInit = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@primuslabs/network-core-sdk', () => ({
  PrimusNetwork: vi.fn().mockImplementation(function MockPrimusNetwork(this: {
    init?: typeof primusInit;
  }) {
    this.init = primusInit;
  }),
}));

vi.mock('../src/shared/logger.js', () => ({
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

describe('createPrimusClient', () => {
  beforeEach(() => {
    primusInit.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    vi.restoreAllMocks();
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

  it('fails over read RPC calls to a secondary endpoint', async () => {
    const sendSpy = vi
      .spyOn(providers.JsonRpcProvider.prototype, 'send')
      .mockImplementation(async function (this: providers.JsonRpcProvider, method: string) {
        const url = (this.connection as { url?: string } | undefined)?.url;
        if (method !== 'eth_blockNumber') {
          throw new Error(`unexpected method ${method}`);
        }
        if (url === 'https://primary.example') {
          throw {
            code: 'SERVER_ERROR',
            status: 502,
            body: 'error code: 502',
            message: 'bad response',
          };
        }
        if (url === 'https://fallback.example') {
          return '0x123';
        }
        throw new Error(`unexpected endpoint ${url}`);
      });

    const { PrimaryFallbackJsonRpcProvider } = await import('../src/primus/rpc-provider.js');
    const provider = new PrimaryFallbackJsonRpcProvider('https://primary.example', 84532, [
      'https://fallback.example',
    ]);

    await expect(provider.send('eth_blockNumber', [])).resolves.toBe('0x123');
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
  });

  it('fails over receipt polling to a secondary endpoint', async () => {
    const sendSpy = vi
      .spyOn(providers.JsonRpcProvider.prototype, 'send')
      .mockImplementation(async function (this: providers.JsonRpcProvider, method: string) {
        const url = (this.connection as { url?: string } | undefined)?.url;
        if (method !== 'eth_getTransactionReceipt') {
          throw new Error(`unexpected method ${method}`);
        }
        if (url === 'https://primary.example') {
          throw {
            code: 'SERVER_ERROR',
            status: 502,
            body: 'error code: 502',
            message: 'bad response',
          };
        }
        if (url === 'https://fallback.example') {
          return { transactionHash: '0xreceipt' };
        }
        throw new Error(`unexpected endpoint ${url}`);
      });

    const { PrimaryFallbackJsonRpcProvider } = await import('../src/primus/rpc-provider.js');
    const provider = new PrimaryFallbackJsonRpcProvider('https://primary.example', 84532, [
      'https://fallback.example',
    ]);

    await expect(provider.send('eth_getTransactionReceipt', ['0xtx'])).resolves.toEqual({
      transactionHash: '0xreceipt',
    });
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps eth_sendRawTransaction on the primary endpoint only', async () => {
    const sendSpy = vi
      .spyOn(providers.JsonRpcProvider.prototype, 'send')
      .mockImplementation(async function (this: providers.JsonRpcProvider) {
        const url = (this.connection as { url?: string } | undefined)?.url;
        if (url === 'https://primary.example') {
          throw {
            code: 'SERVER_ERROR',
            status: 502,
            body: 'error code: 502',
            message: 'bad response',
          };
        }
        throw new Error(`fallback should not be used: ${url}`);
      });

    const { PrimaryFallbackJsonRpcProvider } = await import('../src/primus/rpc-provider.js');
    const provider = new PrimaryFallbackJsonRpcProvider('https://primary.example', 84532, [
      'https://fallback.example',
    ]);

    await expect(provider.send('eth_sendRawTransaction', ['0xsigned'])).rejects.toMatchObject({
      status: 502,
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});
