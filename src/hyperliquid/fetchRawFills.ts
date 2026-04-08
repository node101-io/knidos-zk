import type { RawFills } from './types.js';

const TIMEOUT = 30_000;

export async function fetchRawFills(
  apiUrl: string,
  userAddress: string,
  startTime: number,
  endTime: number,
): Promise<RawFills> {
  const body = {
    type: 'userFillsByTime',
    user: userAddress,
    startTime: startTime,
    endTime: endTime,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Hyperliquid request failed: ${response.status} ${response.statusText}`);
    }

    const rawBuffer = new Uint8Array(await response.arrayBuffer());
    return rawBuffer; //TODO: you can also return the metada like timestamp etc.
  } finally {
    clearTimeout(timeoutId);
  }
}
