import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- mocks (before importing server) ---

vi.mock('hono-rate-limiter', () => ({
  rateLimiter: () => async (_c: unknown, next: () => Promise<void>) => next(),
  RedisStore: vi.fn(),
}));

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock('../src/shared/redis.js', () => ({
  redis: { get: (...args: unknown[]) => mockRedisGet(...args), set: (...args: unknown[]) => mockRedisSet(...args) },
  redisRateLimitClient: {},
}));

vi.mock('../src/env.js', () => ({
  env: { PORT: 3000 },
}));

const mockAggregate = vi.fn();
const mockFindOne = vi.fn();
vi.mock('../src/db/verification-record.js', () => ({
  default: {
    aggregate: (...args: unknown[]) => mockAggregate(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
}));

vi.mock('../src/shared/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

const { app } = await import('../src/server.js');

// --- helpers ---

const get = (path: string) => app.request(path);

function makeRecord(txHash: string) {
  return {
    settlement_time: '2026-01-01T00:00:00.000Z',
    tx_hash: txHash,
    proof_url: `https://zkverify-testnet.subscan.io/extrinsic/${txHash}`,
    vk_hash: 'abc123',
    public_inputs: ['0x1'],
  };
}

// --- tests ---

afterEach(() => {
  mockAggregate.mockReset();
  mockFindOne.mockReset();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
});

describe('GET /api/verifications', () => {
  it('returns first page when no cursor', async () => {
    const data = Array.from({ length: 20 }, (_, i) => makeRecord(`tx-${i}`));
    const nextId = new Types.ObjectId();
    mockAggregate.mockResolvedValueOnce([{ data, next: [{ _id: nextId }] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(20);
    expect(body.next_cursor).toBe(nextId.toHexString());
  });

  it('passes cursor as $match filter when valid ObjectId', async () => {
    const cursor = new Types.ObjectId();
    mockAggregate.mockResolvedValueOnce([{ data: [], next: [] }]);

    await get(`/api/verifications?cursor=${cursor.toHexString()}`);

    const pipeline = mockAggregate.mock.calls[0]![0] as Record<string, unknown>[];
    expect(pipeline[0]).toEqual({ $match: { _id: { $lt: cursor } } });
  });

  it('returns empty data and null next_cursor when no records', async () => {
    mockAggregate.mockResolvedValueOnce([{ data: [], next: [] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it('returns null next_cursor when fewer than a full page', async () => {
    const data = Array.from({ length: 5 }, (_, i) => makeRecord(`tx-${i}`));
    mockAggregate.mockResolvedValueOnce([{ data, next: [] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(5);
    expect(body.next_cursor).toBeNull();
  });

  it('returns 500 for invalid cursor (transform throws before safeParse catches)', async () => {
    const res = await get('/api/verifications?cursor=not-an-objectid');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
  });

  it('returns 500 when aggregate throws', async () => {
    mockAggregate.mockRejectedValueOnce(new Error('db down'));

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
  });

  it('builds correct proof_url with explorer base', async () => {
    const txHash = '0x123abc';
    mockAggregate.mockResolvedValueOnce([{ data: [makeRecord(txHash)], next: [] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(body.data[0].proof_url).toBe(`https://zkverify-testnet.subscan.io/extrinsic/${txHash}`);
  });

  it('returns vk_hash instead of verification_key', async () => {
    mockAggregate.mockResolvedValueOnce([{ data: [makeRecord('tx-1')], next: [] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(body.data[0].vk_hash).toBeDefined();
    expect(body.data[0].verification_key).toBeUndefined();
  });
});

describe('GET /api/vk/:hash', () => {
  it('returns vk from Redis cache on hit', async () => {
    mockRedisGet.mockResolvedValueOnce('0xdeadbeef');

    const res = await get('/api/vk/abc123');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.vk_hash).toBe('abc123');
    expect(body.verification_key).toBe('0xdeadbeef');
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('falls back to MongoDB on cache miss and caches result', async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockFindOne.mockResolvedValueOnce({ vk: '0xcafe', vkHash: 'abc123' });
    mockRedisSet.mockResolvedValueOnce('OK');

    const res = await get('/api/vk/abc123');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.vk_hash).toBe('abc123');
    expect(body.verification_key).toBe('0xcafe');
    expect(mockRedisSet).toHaveBeenCalledWith('vk:abc123', '0xcafe');
  });

  it('returns 404 when hash not found', async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockFindOne.mockResolvedValueOnce(null);

    const res = await get('/api/vk/nonexistent');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Not Found');
  });

  it('returns 500 when Redis/Mongo throws', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('redis down'));

    const res = await get('/api/vk/abc123');
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
  });
});
