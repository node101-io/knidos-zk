import os from 'os';
import path from 'path';

import { createEnv } from '@t3-oss/env-core';
import { utils as ethersUtils } from 'ethers';
import { z } from 'zod';

import { DEFAULT_BINANCE_SYMBOLS, binanceSymbolsSchema } from './shared/binance-symbols.js';
import { zkTLSWindowMinutesSchema } from './shared/scheduler-config.js';

const DEFAULT_BINANCE_API_URL = 'https://fapi.binance.com';
const DEFAULT_RPC_URL = 'https://sepolia.base.org';
const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/node101-knidos-zk-trade';
const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_BB_PATH = path.join(os.homedir(), '.bb', 'bb');

const commaSeparatedUrlListSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}, z.array(z.url()).default([]));

export const env = createEnv({
  server: {
    PRIMUS_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIMUS_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string'),
    PRIMUS_USER_ADDRESS: z
      .string()
      .refine(ethersUtils.isAddress, 'PRIMUS_USER_ADDRESS must be a valid EVM address'),
    BINANCE_API_URL: z.url().default(DEFAULT_BINANCE_API_URL),
    BINANCE_API_KEY: z.string().min(1, 'BINANCE_API_KEY cannot be empty'),
    BINANCE_API_SECRET: z.string().min(1, 'BINANCE_API_SECRET cannot be empty'),
    BINANCE_SYMBOLS: binanceSymbolsSchema.default(DEFAULT_BINANCE_SYMBOLS),
    ZKVERIFY_SEED_PHRASE: z.string().min(1, 'ZKVERIFY_SEED_PHRASE cannot be empty'),
    ZKVERIFY_NETWORK: z.enum(['volta', 'mainnet']).default('volta'),
    ZKVERIFY_DOMAIN_ID: z.coerce.number().int().nonnegative().optional(),
    RPC_URL: z.url().default(DEFAULT_RPC_URL),
    RPC_FALLBACK_URLS: commaSeparatedUrlListSchema,
    PRIMUS_CHAIN_ID: z.coerce.number().int().positive().default(84532),
    MONGO_URI: z.string().min(1, 'MONGO_URI cannot be empty').default(DEFAULT_MONGO_URI),
    REDIS_HOST: z.string().min(1).default(DEFAULT_REDIS_HOST),
    REDIS_PORT: z.coerce.number().int().positive().default(DEFAULT_REDIS_PORT),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // JSON everywhere except local development (pretty is the nicer DX there).
    // zod defaults can only see the raw env, so mirror NODE_ENV's own
    // 'development' fallback here. Override with LOG_FORMAT in any environment.
    LOG_FORMAT: z
      .enum(['json', 'pretty'])
      .default((process.env.NODE_ENV ?? 'development') === 'development' ? 'pretty' : 'json'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_KEY: z.string().min(1, 'API_KEY cannot be empty'),
    STATUS_PASSWORD: z.string().min(1, 'STATUS_PASSWORD cannot be empty'),
    BB_PATH: z.string().min(1).default(DEFAULT_BB_PATH),
    NOIR_PROVING_SLOT_COUNT: z.coerce.number().int().positive().default(1),
    ZKTLS_WINDOW_MINUTES: zkTLSWindowMinutesSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
