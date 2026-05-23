import { createHmac } from 'crypto';

export type RawFills = Uint8Array;

const TIMEOUT = 30_000;

// Build the exact userTrades URL we want both Binance fetchers (zk-node and
// the Primus attestor) to hit. Returning a plain string lets us share the
// same `timestamp+signature` between both sides so they hit Binance with the
// same auth context — and, in practice, hit the same read replica.
export function buildUserTradesUrl(
  apiUrl: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
): string {
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTime),
    endTime: String(endTime),
    recvWindow: '60000',
    timestamp: String(timestamp),
  }).toString();
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');
  return `${apiUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`;
}

// Issue the actual HTTP GET against a pre-built URL. Separated from URL
// construction so we can hand the same URL to the Primus attestor and then
// refetch it ourselves a beat later.
export async function fetchRawFillsByUrl(url: string, apiKey: string): Promise<RawFills> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Binance request failed: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}

// Backwards-compatible composition kept for callers that don't need to share
// the URL with anyone else.
export async function fetchRawFills(
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<RawFills> {
  const url = buildUserTradesUrl(apiUrl, apiSecret, symbol, startTime, endTime);
  return fetchRawFillsByUrl(url, apiKey);
}
