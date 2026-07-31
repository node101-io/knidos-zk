import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendAppriseNotification } from '../src/services/apprise.js';

const TEST_AUTH = { username: 'monitor', password: 'secret' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendAppriseNotification', () => {
  it('posts the notification as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendAppriseNotification(
      'http://apprise:8000/notify',
      {
        title: 'Alert',
        body: 'Pipeline is below its threshold.',
        type: 'failure',
      },
      TEST_AUTH,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://apprise:8000/notify',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Basic bW9uaXRvcjpzZWNyZXQ=',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Alert',
          body: 'Pipeline is below its threshold.',
          type: 'failure',
        }),
      }),
    );
  });

  it('rejects an empty-success response because it means no destination was configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(
      sendAppriseNotification(
        'http://apprise:8000/notify',
        {
          title: 'Alert',
          body: 'No destination',
          type: 'failure',
        },
        TEST_AUTH,
      ),
    ).rejects.toThrow('HTTP 204');
  });

  it('includes a bounded response body in HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('delivery failed', { status: 424 })),
    );

    await expect(
      sendAppriseNotification(
        'http://apprise:8000/notify',
        {
          title: 'Alert',
          body: 'Delivery failure',
          type: 'failure',
        },
        TEST_AUTH,
      ),
    ).rejects.toThrow('HTTP 424: delivery failed');
  });
});
