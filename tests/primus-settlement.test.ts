import { PrimusNetwork } from '@primuslabs/network-core-sdk';
import { BigNumber, Contract } from 'ethers';
import { describe, expect, it, vi, type MockInstance } from 'vitest';

import { settleExpiredPrimusTasks } from '../src/zk-tls/primus-settlement.js';

type PrimusMock = { withdrawBalance: MockInstance };
type ContractMock = { queryBalance: MockInstance };

function buildPrimusMock(overrides: Partial<PrimusMock> = {}): PrimusMock & PrimusNetwork {
  const base: PrimusMock = {
    withdrawBalance: vi.fn().mockResolvedValue(['0xsettled-1', '0xsettled-2']),
    ...overrides,
  };
  return base as PrimusMock & PrimusNetwork;
}

function buildContractMock(balance: {
  toWithdraw: BigNumber;
  toWithdrawTaskCount: BigNumber;
}): Contract {
  const mock: ContractMock = {
    queryBalance: vi.fn().mockResolvedValue(balance),
  };
  return mock as unknown as Contract;
}

describe('settleExpiredPrimusTasks', () => {
  it('skips withdrawBalance when toWithdrawTaskCount is zero', async () => {
    const primus = buildPrimusMock();
    const contract = buildContractMock({
      toWithdraw: BigNumber.from(0),
      toWithdrawTaskCount: BigNumber.from(0),
    });

    const result = await settleExpiredPrimusTasks(primus, contract, 100);

    expect(primus.withdrawBalance).not.toHaveBeenCalled();
    expect(result).toEqual({ settled: [], toWithdrawWei: '0' });
  });

  it('calls withdrawBalance with ETH + maxWithdrawLimit and returns settled ids', async () => {
    const primus = buildPrimusMock();
    const contract = buildContractMock({
      toWithdraw: BigNumber.from('1000000000000'),
      toWithdrawTaskCount: BigNumber.from(42),
    });

    const result = await settleExpiredPrimusTasks(primus, contract, 100);

    expect(primus.withdrawBalance).toHaveBeenCalledTimes(1);
    expect(primus.withdrawBalance).toHaveBeenCalledWith(0, 100);
    expect(result).toEqual({
      settled: ['0xsettled-1', '0xsettled-2'],
      toWithdrawWei: '1000000000000',
    });
  });

  it('propagates errors from withdrawBalance', async () => {
    const primus = buildPrimusMock({
      withdrawBalance: vi.fn().mockRejectedValue(new Error('rpc boom')),
    });
    const contract = buildContractMock({
      toWithdraw: BigNumber.from('500'),
      toWithdrawTaskCount: BigNumber.from(5),
    });

    await expect(settleExpiredPrimusTasks(primus, contract, 100)).rejects.toThrow('rpc boom');
  });
});
