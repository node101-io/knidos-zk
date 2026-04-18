import { Types } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- mocks (before importing server) ---

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock('../src/shared/redis.js', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

const TEST_API_KEY = 'test-key-123';
vi.mock('../src/env.js', () => ({
  env: { PORT: 3000, API_KEY: TEST_API_KEY, MONGO_URI: 'mongodb://localhost/test' },
}));

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return { ...actual, default: { ...actual.default, connect: vi.fn() } };
});

vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));

const mockAggregate = vi.fn();
const mockFindOne = vi.fn();
vi.mock('../src/db/verification-record.js', () => ({
  default: {
    aggregate: (...args: unknown[]) => mockAggregate(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
}));

const mockRegisteredVkFindOne = vi.fn();
vi.mock('../src/db/registered-vk.js', () => ({
  default: {
    findOne: (...args: unknown[]) => mockRegisteredVkFindOne(...args),
  },
}));

vi.mock('../src/shared/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

const { app } = await import('../src/server.js');

// --- helpers ---

const get = (path: string, headers?: Record<string, string>) =>
  app.request(path, { headers: { 'x-api-key': TEST_API_KEY, ...headers } });

const getNoAuth = (path: string) => app.request(path);

function makeRecord(txHash: string) {
  return {
    settlement_time: '2026-01-01T00:00:00.000Z',
    start_time: '2025-12-31T23:45:00.000Z',
    end_time: '2026-01-01T00:00:00.000Z',
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
  mockRegisteredVkFindOne.mockReset();
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

  it('returns 400 for invalid cursor', async () => {
    const res = await get('/api/verifications?cursor=not-an-objectid');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Bad Request');
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

  it('returns named time window fields alongside public_inputs', async () => {
    mockAggregate.mockResolvedValueOnce([{ data: [makeRecord('tx-1')], next: [] }]);

    const res = await get('/api/verifications');
    const body = await res.json();

    expect(body.data[0].start_time).toBe('2025-12-31T23:45:00.000Z');
    expect(body.data[0].end_time).toBe('2026-01-01T00:00:00.000Z');
    expect(body.data[0].public_inputs).toEqual(['0x1']);
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
    expect(mockRegisteredVkFindOne).not.toHaveBeenCalled();
  });

  it('falls back to MongoDB on cache miss and caches result', async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    mockRegisteredVkFindOne.mockResolvedValueOnce({ vk: '0xcafe' });
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
    mockRegisteredVkFindOne.mockResolvedValueOnce(null);

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

describe('API key authentication', () => {
  it('returns 401 when x-api-key header is missing', async () => {
    const res = await getNoAuth('/api/verifications');
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when x-api-key is wrong', async () => {
    const res = await get('/api/vk/abc123', { 'x-api-key': 'wrong-key' });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('does not require auth for /api/docs', async () => {
    const res = await getNoAuth('/api/docs');
    expect(res.status).toBe(200);
  });

  it('does not require auth for /api/openapi', async () => {
    const res = await getNoAuth('/api/openapi');
    expect(res.status).toBe(200);
  });
});

describe('OpenAPI documentation', () => {
  it('serves OpenAPI spec at /api/openapi', async () => {
    const res = await get('/api/openapi');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('Knidos ZK Verification API');
    expect(body.paths['/api/verifications']).toBeDefined();
    expect(body.paths['/api/vk/{hash}']).toBeDefined();
  });

  it('serves Scalar docs UI at /api/docs', async () => {
    const res = await get('/api/docs');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});
