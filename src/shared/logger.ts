import pino, { type LoggerOptions } from 'pino';
import { env } from '../env.js';

const PINO_LEVEL_TO_SEVERITY = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
} as const;

const PRETTY_TRANSPORT_OPTIONS = {
  colorize: true,
  translateTime: 'HH:MM:ss',
  ignore: 'pid,hostname',
} as const;

const REDACT_PATHS = [
  '*.circuitInput',
  '*.proofHex',
  '*.vkHex',
  '*.publicSignals',
  '*.proof',
  '*.vk',
  'circuitInput',
  'proofHex',
  'vkHex',
  'publicSignals',
] as const;

const AXIOM_MISSING_CONFIG_MESSAGE =
  '[logger] Axiom disabled in production: AXIOM_TOKEN and AXIOM_DATASET must both be set';

const isProduction = env.NODE_ENV === 'production';
const hasAxiomConfig = Boolean(env.AXIOM_TOKEN && env.AXIOM_DATASET);

const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: 'knidos-zk',
    env: env.NODE_ENV,
  },
  serializers: {
    error: pino.stdSerializers.err,
  },
  formatters: {
    level(label, number) {
      return {
        severity:
          PINO_LEVEL_TO_SEVERITY[label as keyof typeof PINO_LEVEL_TO_SEVERITY] ??
          PINO_LEVEL_TO_SEVERITY.info,
        level: number,
      };
    },
  },
  redact: {
    paths: [...REDACT_PATHS],
    remove: true,
  },
};

function createTransport(): ReturnType<typeof pino.transport> | undefined {
  if (!isProduction) {
    return pino.transport({
      target: 'pino-pretty',
      options: PRETTY_TRANSPORT_OPTIONS,
    });
  }

  if (!hasAxiomConfig) {
    return undefined;
  }

  return pino.transport({
    targets: [
      {
        target: 'pino/file',
        options: {
          destination: 1,
        },
      },
      {
        target: '@axiomhq/pino',
        options: {
          dataset: env.AXIOM_DATASET,
          token: env.AXIOM_TOKEN,
        },
      },
    ],
  });
}

function createLogger() {
  const transport = createTransport();
  const logger = transport ? pino(loggerOptions, transport) : pino(loggerOptions);

  if (isProduction && !hasAxiomConfig) {
    logger.warn(
      {
        hasAxiomToken: Boolean(env.AXIOM_TOKEN),
        hasAxiomDataset: Boolean(env.AXIOM_DATASET),
      },
      AXIOM_MISSING_CONFIG_MESSAGE,
    );
  }

  return logger;
}

const logger = createLogger();

export default logger;
