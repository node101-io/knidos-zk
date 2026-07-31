import { Buffer } from 'node:buffer';

interface AppriseNotification {
  title: string;
  body: string;
  type: 'failure';
}

interface AppriseBasicAuth {
  username: string;
  password: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function sendAppriseNotification(
  notifyUrl: string,
  notification: AppriseNotification,
  auth: AppriseBasicAuth,
): Promise<void> {
  const authorization = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  const response = await fetch(notifyUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(notification),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 200) return;

  const responseBody = (await response.text()).slice(0, 500);
  throw new Error(
    `[apprise] notification failed with HTTP ${response.status}${
      responseBody ? `: ${responseBody}` : ''
    }`,
  );
}
