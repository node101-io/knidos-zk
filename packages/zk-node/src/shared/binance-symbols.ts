import { z } from 'zod';

export const SUPPORTED_BINANCE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'LINKUSDT',
] as const;

export const DEFAULT_BINANCE_SYMBOLS = [...SUPPORTED_BINANCE_SYMBOLS];

export type SupportedBinanceSymbol = (typeof SUPPORTED_BINANCE_SYMBOLS)[number];

const supportedSymbolSet = new Set<string>(SUPPORTED_BINANCE_SYMBOLS);

function findDuplicateSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const symbol of symbols) {
    if (seen.has(symbol)) {
      duplicates.add(symbol);
      continue;
    }

    seen.add(symbol);
  }

  return [...duplicates];
}

export const binanceSymbolsSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    return value
      .split(',')
      .map((symbol) => symbol.trim())
      .filter((symbol) => symbol.length > 0);
  },
  z
    .array(z.string().min(1))
    .min(1, 'BINANCE_SYMBOLS cannot be empty')
    .superRefine((symbols, ctx) => {
      const duplicates = findDuplicateSymbols(symbols);
      const unsupportedSymbols = symbols.filter((symbol) => !supportedSymbolSet.has(symbol));

      if (duplicates.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `BINANCE_SYMBOLS contains duplicates: ${duplicates.join(', ')}`,
        });
      }

      if (unsupportedSymbols.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `BINANCE_SYMBOLS contains unsupported symbols: ${unsupportedSymbols.join(', ')}`,
        });
      }
    })
    .transform((symbols) => symbols as SupportedBinanceSymbol[]),
);
