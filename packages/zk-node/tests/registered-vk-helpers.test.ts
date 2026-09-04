import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();
const mockExecute = vi.fn();

vi.mock('../src/db/registered-vk.js', () => ({
  RegisteredVk: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

vi.mock('../src/shared/zkverifyjs.js', () => ({
  UltrahonkVariant: { Plain: 'Plain' },
}));

const { findOrRegisterVk } = await import('../src/db/registered-vk-helpers.js');

const VK = `0x${'ab'.repeat(1760)}`;
const STATEMENT_HASH = `0x${createHash('sha256')
  .update(Buffer.from('ab'.repeat(1760), 'hex'))
  .digest('hex')}`;

function buildSession() {
  return {
    registerVerificationKey: () => ({
      ultrahonk: () => ({ execute: (...args: unknown[]) => mockExecute(...args) }),
    }),
  } as never;
}

beforeEach(() => {
  mockFindOne.mockReset();
  mockFindOneAndUpdate.mockReset();
  mockExecute.mockReset();
  mockFindOneAndUpdate.mockImplementation(async (_query, update) => update.$setOnInsert);
});

describe('findOrRegisterVk', () => {
  it('returns the stored row without touching zkverify', async () => {
    mockFindOne.mockResolvedValue({ statementHash: '0xstored' });

    const result = await findOrRegisterVk({ vk: VK, network: 'volta', session: buildSession() });

    expect(result).toEqual({ statementHash: '0xstored' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('registers a new key and persists the statement hash zkverify returned', async () => {
    mockFindOne.mockResolvedValue(null);
    mockExecute.mockResolvedValue({
      transactionResult: Promise.resolve({ statementHash: STATEMENT_HASH }),
    });

    const result = await findOrRegisterVk({ vk: VK, network: 'volta', session: buildSession() });

    expect(mockExecute).toHaveBeenCalledWith(VK);
    expect(result.statementHash).toBe(STATEMENT_HASH);
  });

  it('adopts a key that is already registered on chain with a locally derived statement hash', async () => {
    // Mirrors zkverifyjs' decoded VerificationKeyAlreadyRegistered dispatch error.
    mockFindOne.mockResolvedValue(null);
    mockExecute.mockRejectedValue(new Error('Verification key has already been registered.'));

    const result = await findOrRegisterVk({ vk: VK, network: 'volta', session: buildSession() });

    expect(result.statementHash).toBe(STATEMENT_HASH);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('rethrows other registration errors', async () => {
    mockFindOne.mockResolvedValue(null);
    mockExecute.mockRejectedValue(new Error('Inability to pay some fees'));

    await expect(
      findOrRegisterVk({ vk: VK, network: 'volta', session: buildSession() }),
    ).rejects.toThrow('Inability to pay some fees');
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('persists the chain statement hash, then fails loudly if the local formula drifted', async () => {
    mockFindOne.mockResolvedValue(null);
    mockExecute.mockResolvedValue({
      transactionResult: Promise.resolve({ statementHash: '0xsomething-else' }),
    });

    await expect(
      findOrRegisterVk({ vk: VK, network: 'volta', session: buildSession() }),
    ).rejects.toThrow(/statementHash formula drift/);
    // The chain's answer is authoritative and must already be stored, so the
    // next run finds it in Mongo instead of deriving a wrong one.
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockFindOneAndUpdate.mock.calls[0]?.[1]).toMatchObject({
      $setOnInsert: { statementHash: '0xsomething-else' },
    });
  });
});
