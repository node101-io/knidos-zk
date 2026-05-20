import { providers } from 'ethers';

import logger from '../shared/logger.js';
import { collectErrorStatusCodes, isTransientPrimusRpc } from './errors.js';

const PRIMARY_ONLY_RPC_METHODS = new Set(['eth_sendRawTransaction']);

function normalizeFallbackUrls(primaryUrl: string, fallbackUrls: readonly string[]): string[] {
  const seen = new Set([primaryUrl]);
  const normalized: string[] = [];

  for (const fallbackUrl of fallbackUrls) {
    if (seen.has(fallbackUrl)) continue;
    seen.add(fallbackUrl);
    normalized.push(fallbackUrl);
  }

  return normalized;
}

function getProviderUrl(provider: providers.JsonRpcProvider): string | null {
  const connection = provider.connection as { url?: unknown } | undefined;
  return typeof connection?.url === 'string' ? connection.url : null;
}

function extractErrorStatusCode(error: unknown): number | null {
  return collectErrorStatusCodes(error)[0] ?? null;
}

function createFallbackProviders(
  primaryUrl: string,
  fallbackUrls: readonly string[],
  network: providers.Networkish,
): providers.StaticJsonRpcProvider[] {
  return normalizeFallbackUrls(primaryUrl, fallbackUrls).map(
    (url) => new providers.StaticJsonRpcProvider(url, network),
  );
}

export class PrimaryFallbackJsonRpcProvider extends providers.StaticJsonRpcProvider {
  private readonly secondaryProviders: providers.StaticJsonRpcProvider[];

  constructor(
    primaryUrl: string,
    network: providers.Networkish,
    fallbackUrls: readonly string[] = [],
  ) {
    super(primaryUrl, network);
    this.secondaryProviders = createFallbackProviders(primaryUrl, fallbackUrls, network);
  }

  override async send(method: string, params: Array<unknown>): Promise<unknown> {
    if (PRIMARY_ONLY_RPC_METHODS.has(method) || this.secondaryProviders.length === 0) {
      return super.send(method, params);
    }

    try {
      return await super.send(method, params);
    } catch (primaryError) {
      if (!isTransientPrimusRpc(primaryError)) throw primaryError;
      return this.sendWithFallbacks(method, params, primaryError);
    }
  }

  private async sendWithFallbacks(
    method: string,
    params: Array<unknown>,
    primaryError: unknown,
  ): Promise<unknown> {
    const primaryUrl = getProviderUrl(this);
    logger.warn(
      {
        method,
        status: extractErrorStatusCode(primaryError),
        endpoint: primaryUrl,
      },
      '[primus rpc] primary failed, trying fallback',
    );

    let lastError: unknown = primaryError;
    for (const provider of this.secondaryProviders) {
      try {
        const result = await provider.send(method, params);
        logger.info(
          {
            method,
            status: extractErrorStatusCode(primaryError),
            endpoint: getProviderUrl(provider),
            failedEndpoint: primaryUrl,
          },
          '[primus rpc] fallback succeeded',
        );
        return result;
      } catch (fallbackError) {
        logger.warn(
          {
            method,
            status: extractErrorStatusCode(fallbackError),
            endpoint: getProviderUrl(provider),
          },
          '[primus rpc] fallback failed',
        );

        if (!isTransientPrimusRpc(fallbackError)) throw fallbackError;
        lastError = fallbackError;
      }
    }

    throw lastError;
  }
}
