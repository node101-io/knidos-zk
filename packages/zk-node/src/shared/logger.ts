import pino from 'pino';
import { env } from '../env.js';

// `env.LOG_FORMAT` is resolved in env.ts (JSON by default, pretty in local
// development, overridable anywhere). In production keep JSON for `jq`, and set
// LOG_FORMAT=pretty when you want the daemon to render the human stream itself
// (pino-pretty is a runtime dependency, so it is present in the image).
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
  env.LOG_FORMAT === 'pretty'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined,
);

export default logger;
