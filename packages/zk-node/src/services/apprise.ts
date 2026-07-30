interface AppriseNotification {
  title: string;
  body: string;
  type: 'failure';
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function sendAppriseNotification(
  notifyUrl: string,
  notification: AppriseNotification,
): Promise<void> {
  const response = await fetch(notifyUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
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
