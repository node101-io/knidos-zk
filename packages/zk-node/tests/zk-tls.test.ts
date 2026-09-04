import { createHash } from 'crypto';

import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredTask = { _id: mongoose.Types.ObjectId; primus: unknown };

const taskStore = new Map<string, StoredTask>();
const mockFetchRawFillsByRequest = vi.fn();
const mockSubmitWithCapacity = vi.fn();
const mockAttestPrimusTask = vi.fn();
const mockVerifyPrimusTask = vi.fn();

const input = {
  startTime: new Date(1769172979000),
  endTime: new Date(1769172996000),
  baseBalance: 100_000_000,
  threshold: 50_000_000,
};

// 42-byte "0x"-prefixed address string, the width the circuit hashes.
const HL_ADDRESS = `0x${'aA'.repeat(20)}`;
const ADDRESS_COMMITMENT = `0x${'ab'.repeat(32)}`;
const ADDRESS_SALT = `0x${'cd'.repeat(16)}`;
const FILLS_SALT = `0x${'ef'.repeat(16)}`;

const attest = {
  reportTxHash: '0xreport-tx',
  request: {
    url: 'https://test.hyperliquid/info',
    method: 'POST' as const,
    header: { 'Content-Type': 'application/json' },
    body: { type: 'userFillsByTime' as const, user: HL_ADDRESS, startTime: 0, endTime: 1 },
  },
  attestedAt: Date.now(),
  fillsSalt: FILLS_SALT,
  addressSalt: ADDRESS_SALT,
};

vi.mock('../src/db/task.js', async () => {
  const actual = await vi.importActual<typeof import('../src/db/task.js')>('../src/db/task.js');
  return {
    ...actual,
    Task: {
      findById: vi.fn((id: string) => ({
        lean: async () => taskStore.get(id) ?? null,
      })),
    },
  };
});

vi.mock('../src/db/task-helpers.js', () => ({
  setPrimusCheckpoint: vi.fn(async (id: string, checkpoint: unknown) => {
    const task = taskStore.get(id);
    if (task) task.primus = checkpoint;
  }),
  clearPrimusCheckpoint: vi.fn(async (id: string) => {
    const task = taskStore.get(id);
    if (task) task.primus = null;
  }),
}));

vi.mock('../src/primus/capacity.js', () => ({
  submitWithCapacity: (...args: unknown[]) => mockSubmitWithCapacity(...args),
}));

vi.mock('../src/primus/client.js', () => ({
  primusClient: {
    taskTimeoutMs: vi.fn(async () => 15 * 60 * 1000),
    sdk: vi.fn(async () => ({})),
  },
}));

vi.mock('../src/primus/task.js', () => ({
  attestPrimusTask: (...args: unknown[]) => mockAttestPrimusTask(...args),
  verifyPrimusTask: (...args: unknown[]) => mockVerifyPrimusTask(...args),
}));

vi.mock('../src/utils/fetch-raw-fills.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/fetch-raw-fills.js')>(
    '../src/utils/fetch-raw-fills.js',
  );
  return {
    ...actual,
    fetchRawFillsByRequest: (...args: unknown[]) => mockFetchRawFillsByRequest(...args),
  };
});

const { runZkTLSProcessor } = await import('../src/pipelines/zk-tls/processor.js');

function makeTask(): StoredTask {
  const task = { _id: new mongoose.Types.ObjectId(), primus: null };
  taskStore.set(task._id.toString(), task);
  return task;
}

// Mirrors Primus' SHA256_WITH_SALT: sha256(body || salt).
function sha256Hex(body: string): string {
  return `0x${createHash('sha256')
    .update(Buffer.from(body, 'utf8'))
    .update(Buffer.from(FILLS_SALT.slice(2), 'hex'))
    .digest('hex')}`;
}

function mockRawFills(body: string, commitment = sha256Hex(body)): void {
  mockFetchRawFillsByRequest.mockResolvedValue(new Uint8Array(Buffer.from(body, 'utf8')));
  mockVerifyPrimusTask.mockResolvedValue({
    fillsCommitment: commitment,
    addressCommitment: ADDRESS_COMMITMENT,
  });
}

beforeEach(() => {
  taskStore.clear();
  mockFetchRawFillsByRequest.mockReset();
  mockSubmitWithCapacity.mockReset();
  mockAttestPrimusTask.mockReset();
  mockVerifyPrimusTask.mockReset();

  mockSubmitWithCapacity.mockResolvedValue({
    taskId: '0xprimus-task',
    taskTxHash: '0xsubmit-tx',
    taskAttestors: ['0xattestor'],
    submittedAt: Date.now(),
  });
  mockAttestPrimusTask.mockResolvedValue(attest);
});

describe('zk-tls processor', () => {
  it('accepts valid empty fills when the Primus commitment matches', async () => {
    mockRawFills('[]');

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result.action).toBe('completed');
    if (result.action !== 'completed') throw new Error('expected completed result');
    expect(result.input.rawFillsLength).toBe(2);
    expect(result.input.addressCommitment).toHaveLength(2);
    // 42-byte address string and 16-byte salt, as the circuit expects. The
    // address comes from the attested request body, not from env, so a config
    // change between attest and witness cannot break the commitment.
    expect(Buffer.from(result.input.address).toString('utf8')).toBe(HL_ADDRESS);
    expect(result.input.addressSalt).toHaveLength(16);
    expect(result.input.fillsSalt).toHaveLength(16);
  });

  it('defers Hyperliquid error bodies before creating Noir input', async () => {
    const body = '{"error":"Rate limited"}';
    mockRawFills(body);

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result).toMatchObject({ action: 'defer', reason: 'hyperliquid_response_invalid' });
    expect(task.primus).toBeNull();
  });

  it('defers when local rawFills do not match the Primus commitment', async () => {
    mockRawFills('[]', sha256Hex('{"error":"Rate limited"}'));

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result).toMatchObject({ action: 'defer', reason: 'primus_commitment_mismatch' });
    expect(task.primus).toBeNull();
  });

  it('fails permanently before Primus when the window has more fills than the circuit parses', async () => {
    const fill = {
      coin: 'XRP',
      closedPnl: '0.0',
      fee: '0.01',
      feeToken: 'USDC',
      time: 1769172980321,
    };
    mockFetchRawFillsByRequest.mockResolvedValue(
      new Uint8Array(Buffer.from(JSON.stringify(Array(17).fill(fill)), 'utf8')),
    );

    const task = makeTask();
    await expect(runZkTLSProcessor(task._id.toString(), input)).rejects.toThrow(
      /17 fills .*\(max 16 fills/,
    );
    // No Primus task was bought for an unprovable window.
    expect(mockSubmitWithCapacity).not.toHaveBeenCalled();
  });

  it('fails permanently before Primus when the body is wider than the circuit buffer', async () => {
    const fill = {
      coin: 'XRP',
      closedPnl: '0.0',
      fee: '0.01',
      feeToken: 'USDC',
      pad: 'x'.repeat(900),
    };
    mockFetchRawFillsByRequest.mockResolvedValue(
      new Uint8Array(Buffer.from(JSON.stringify(Array(10).fill(fill)), 'utf8')),
    );

    const task = makeTask();
    await expect(runZkTLSProcessor(task._id.toString(), input)).rejects.toThrow(
      /bytes \(max 16 fills \/ 8192 bytes\)/,
    );
    expect(mockSubmitWithCapacity).not.toHaveBeenCalled();
  });

  it('rejects an unsalted commitment over the same body', async () => {
    // Guards the salting itself: a plain sha256(body) must not be accepted.
    const unsalted = `0x${createHash('sha256').update('[]').digest('hex')}`;
    mockRawFills('[]', unsalted);

    const task = makeTask();
    const result = await runZkTLSProcessor(task._id.toString(), input);

    expect(result).toMatchObject({ action: 'defer', reason: 'primus_commitment_mismatch' });
    expect(task.primus).toBeNull();
  });
});
