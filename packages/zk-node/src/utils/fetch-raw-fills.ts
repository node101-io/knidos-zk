import { env } from '../env.js';

export type RawFills = Uint8Array;

const TIMEOUT = 30_000;

// The exact HTTP call the Primus attestor is asked to make and that we later
// replay ourselves. Both sides must observe the same response body, since the
// proof commits to sha256 of it. Kept as a plain object so the very same value
// can be handed to the SDK and persisted in the task checkpoint.
export interface UserFillsRequest {
  url: string;
  method: 'POST';
  header: Record<string, string>;
  body: {
    type: 'userFillsByTime';
    user: string;
    startTime: number;
    endTime: number;
  };
}

// The request carries no timestamp or signature, so once attested it never
// goes stale and can be replayed whenever the worker resumes.
export function buildUserFillsRequest(startTime: number, endTime: number): UserFillsRequest {
  return {
    url: env.HYPERLIQUID_API_URL,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    // The attestor hashes this exact `user` string for the address
    // commitment, so the circuit must be handed the same casing.
    body: {
      type: 'userFillsByTime',
      user: env.HYPERLIQUID_USER_ADDRESS,
      startTime,
      endTime,
    },
  };
}

export async function fetchRawFillsByRequest(request: UserFillsRequest): Promise<RawFills> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        ...request.header,
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeoutId);
  }
}
