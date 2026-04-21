import { afterEach, describe, expect, it, vi } from 'vitest';

type LoggerStub = {
  warn: ReturnType<typeof vi.fn>;
};

async function loadLoggerModule(envOverrides: Record<string, unknown> = {}) {
  vi.resetModules();

  const loggerStub: LoggerStub = {
    warn: vi.fn(),
  };
  const pinoFn = vi.fn(() => loggerStub);
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
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      AXIOM_TOKEN: undefined,
      AXIOM_DATASET: undefined,
      ...envOverrides,
    },
  }));

  const module = await import('../src/shared/logger.js');
  return { module, loggerStub, pinoFn, transportFn };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock('pino');
  vi.doUnmock('../src/env.js');
});

describe('logger factory', () => {
  it('uses pino-pretty transport in development', async () => {
    const { transportFn, pinoFn } = await loadLoggerModule({
      NODE_ENV: 'development',
    });

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
      expect.objectContaining({
        level: 'info',
      }),
      {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      },
    );
  });

  it('uses pino-pretty transport in test', async () => {
    const { transportFn } = await loadLoggerModule({
      NODE_ENV: 'test',
    });

    expect(transportFn).toHaveBeenCalledWith({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    });
  });

  it('configures dual-write transport in production when Axiom is enabled', async () => {
    const { transportFn, pinoFn, loggerStub } = await loadLoggerModule({
      NODE_ENV: 'production',
      AXIOM_TOKEN: 'axiom-token',
      AXIOM_DATASET: 'knidos-zk-logs',
    });

    expect(transportFn).toHaveBeenCalledWith({
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 },
        },
        {
          target: '@axiomhq/pino',
          options: {
            dataset: 'knidos-zk-logs',
            token: 'axiom-token',
          },
        },
      ],
    });
    expect(pinoFn).toHaveBeenCalledOnce();
    expect(loggerStub.warn).not.toHaveBeenCalled();
  });

  it('falls back to stdout and warns once when Axiom config is missing in production', async () => {
    const { transportFn, pinoFn, loggerStub } = await loadLoggerModule({
      NODE_ENV: 'production',
      AXIOM_TOKEN: 'axiom-token',
      AXIOM_DATASET: undefined,
    });

    expect(transportFn).not.toHaveBeenCalled();
    expect(pinoFn).toHaveBeenCalledOnce();
    expect(pinoFn.mock.calls[0]).toHaveLength(1);
    expect(loggerStub.warn).toHaveBeenCalledOnce();
    expect(loggerStub.warn.mock.calls[0]?.[0]).toEqual({
      hasAxiomToken: true,
      hasAxiomDataset: false,
    });
  });

  it('maps Pino levels to Axiom severities and keeps numeric levels', async () => {
    const { pinoFn } = await loadLoggerModule();
    expect(pinoFn).toHaveBeenCalledOnce();

    const firstCall = pinoFn.mock.calls.at(0);
    const options = (firstCall?.at(0) ?? null) as unknown as {
      formatters?: { level?: (label: string, number: number) => Record<string, unknown> };
    };

    expect(options.formatters?.level?.('trace', 10)).toEqual({
      severity: 'DEBUG',
      level: 10,
    });
    expect(options.formatters?.level?.('debug', 20)).toEqual({
      severity: 'DEBUG',
      level: 20,
    });
    expect(options.formatters?.level?.('info', 30)).toEqual({
      severity: 'INFO',
      level: 30,
    });
    expect(options.formatters?.level?.('warn', 40)).toEqual({
      severity: 'WARNING',
      level: 40,
    });
    expect(options.formatters?.level?.('error', 50)).toEqual({
      severity: 'ERROR',
      level: 50,
    });
    expect(options.formatters?.level?.('fatal', 60)).toEqual({
      severity: 'CRITICAL',
      level: 60,
    });
  });
});
