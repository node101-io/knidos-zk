import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeProvider extends EventEmitter {
  isConnected = true;
}

interface FakeSession {
  provider: FakeProvider;
  close: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  id: number;
}

let createdSessions: FakeSession[] = [];
let transactionResultFactory: () => Promise<unknown> = () =>
  Promise.resolve({ statement: '0xstmt', aggregationId: 7 });

function makeFakeSession(id: number): FakeSession {
  const provider = new FakeProvider();
  const session: FakeSession = {
    provider,
    close: vi.fn(async () => {}),
    id,
    verify: vi.fn(() => ({
      ultrahonk: () => ({
        withRegisteredVk: () => ({
          execute: async () => ({
            events: new EventEmitter(),
            transactionResult: transactionResultFactory(),
          }),
        }),
      }),
    })),
  };
  return session;
}

vi.mock('zkverifyjs', () => {
  const withAccount = vi.fn(async () => {
    const session = makeFakeSession(createdSessions.length);
    createdSessions.push(session);
    return session;
  });
  const networkBuilder = { withAccount };
  return {
    zkVerifySession: {
      start: () => ({
        Volta: () => networkBuilder,
        zkVerify: () => networkBuilder,
      }),
    },
    UltrahonkVariant: { Plain: 'Plain' },
    UltrahonkVersion: { V0_84: 'V0_84', V3_0: 'V3_0', Legacy: 'Legacy' },
  };
});

vi.mock('../src/db/registered-vk-helpers.js', () => ({
  findOrRegisterVk: vi.fn(async () => ({ statementHash: '0xstatement' })),
}));

const input = {
  vk: '0xvk',
  proof: '0xproof',
  publicSignals: ['0x1'],
};

beforeEach(() => {
  createdSessions = [];
  transactionResultFactory = () => Promise.resolve({ statement: '0xstmt', aggregationId: 7 });
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadProcessor() {
  return import('../src/pipelines/zk-verify/processor.js');
}

describe('zkVerify session resilience', () => {
  it('reuses the cached session while the provider stays connected', async () => {
    const { runZkVerifyProcessor } = await loadProcessor();

    await runZkVerifyProcessor(input);
    await runZkVerifyProcessor(input);

    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]!.close).not.toHaveBeenCalled();
  });

  it('recreates the session when the cached provider is disconnected', async () => {
    const { runZkVerifyProcessor } = await loadProcessor();

    await runZkVerifyProcessor(input);
    createdSessions[0]!.provider.isConnected = false;

    await runZkVerifyProcessor(input);

    expect(createdSessions).toHaveLength(2);
    expect(createdSessions[0]!.close).toHaveBeenCalledTimes(1);
    expect(createdSessions[1]!.provider.isConnected).toBe(true);
  });

  it('invalidates the cached session when the provider emits disconnected', async () => {
    const { runZkVerifyProcessor } = await loadProcessor();

    await runZkVerifyProcessor(input);

    const first = createdSessions[0]!;
    first.provider.isConnected = false;
    first.provider.emit('disconnected');
    // Let the async invalidation settle before the next call.
    await Promise.resolve();
    await Promise.resolve();

    await runZkVerifyProcessor(input);

    expect(createdSessions).toHaveLength(2);
    expect(first.close).toHaveBeenCalled();
  });

  it('times out and tears down the session when transactionResult never resolves', async () => {
    transactionResultFactory = () => new Promise(() => {});

    vi.useFakeTimers();
    const { runZkVerifyProcessor } = await loadProcessor();

    const pending = runZkVerifyProcessor(input);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;

    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]!.close).toHaveBeenCalled();

    // Next call must build a fresh session.
    vi.useRealTimers();
    transactionResultFactory = () => Promise.resolve({ statement: '0xstmt2', aggregationId: 8 });
    await runZkVerifyProcessor(input);
    expect(createdSessions).toHaveLength(2);
  });
});
