import { createHmac } from 'crypto';

export type RawFills = Uint8Array;

const TIMEOUT = 30_000;

export async function fetchRawFills(
  apiUrl: string,
  apiKey: string,
  apiSecret: string,
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<RawFills> {
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    symbol,
    startTime: String(startTime),
    endTime: String(endTime),
    recvWindow: '60000',
    timestamp: String(timestamp),
  }).toString();
  const signature = createHmac('sha256', apiSecret).update(queryString).digest('hex');
  const url = `${apiUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

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
