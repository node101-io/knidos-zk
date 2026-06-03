import type { SubmitRequest, SubmitResponse } from '../../types.js';

import { API_URL } from './constants.js';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function submitAnswers(args: SubmitRequest): Promise<SubmitResponse> {
  return post<SubmitResponse>('/api/submit', args);
}
