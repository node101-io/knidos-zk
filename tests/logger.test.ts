import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadLoggerModule() {
  vi.resetModules();

  const pinoFn = vi.fn(() => ({ warn: vi.fn() }));
  const transportFn = vi.fn((options: Record<string, unknown>) => ({ transport: options }));
  (
    pinoFn as typeof pinoFn & { transport: typeof transportFn; stdSerializers: { err: string } }
  ).transport = transportFn;
  (
    pinoFn as typeof pinoFn & { transport: typeof transportFn; stdSerializers: { err: string } }
  ).stdSerializers = { err: 'err' };

  vi.doMock('pino', () => ({
    default: pinoFn,
  }));
  vi.doMock('../src/env.js', () => ({
    env: {
      NODE_ENV: 'production',
    },
  }));

  await import('../src/shared/logger.js');
  return { pinoFn, transportFn };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock('pino');
  vi.doUnmock('../src/env.js');
});

describe('logger', () => {
  it('wires pino-pretty transport with the configured options', async () => {
    const { pinoFn, transportFn } = await loadLoggerModule();

    expect(transportFn).toHaveBeenCalledWith({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    });
    expect(pinoFn).toHaveBeenCalledOnce();
    expect(pinoFn).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info' }),
      expect.objectContaining({
        transport: expect.objectContaining({ target: 'pino-pretty' }),
      }),
    );
  });
});
