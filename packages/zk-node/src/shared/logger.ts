import pino from 'pino';
import { env } from '../env.js';

const logger = pino(
  {
    level: 'info',
    base: {
      service: 'knidos-zk',
      env: env.NODE_ENV,
    },
    serializers: {
      error: pino.stdSerializers.err,
    },
    redact: {
      paths: [
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
      ],
      remove: true,
    },
  },
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  }),
);

export default logger;
