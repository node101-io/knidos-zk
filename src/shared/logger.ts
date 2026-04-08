import pino from 'pino';
import { env } from '../config/env.js';

const isProduction = env.NODE_ENV === 'production';

const logger = pino({
  level: env.LOG_LEVEL,
  ...(!isProduction && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
