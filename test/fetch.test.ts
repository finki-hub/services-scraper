import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '../src/utils/fetch.js';

const TEST_URL = 'https://example.invalid';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('uses a 30-second timeout and preserves request options', async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));
    const headers = new Headers({ Authorization: 'token' });
    const init = { body: 'payload', headers, method: 'POST' };

    await fetchWithTimeout(TEST_URL, init);

    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(TEST_URL, {
      ...init,
      signal: controller.signal,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBe(headers);
  });

  it('combines the timeout and caller cancellation signals', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const callerController = new AbortController();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));

    await fetchWithTimeout(TEST_URL, {
      signal: callerController.signal,
    });

    const signal = fetchMock.mock.calls[0]?.[1]?.signal;

    expect(signal).toBeDefined();
    expect(signal).not.toBe(callerController.signal);
    expect(signal).not.toBe(timeoutController.signal);

    expect(signal?.reason).toBeUndefined();

    callerController.abort(new Error('caller stopped'));

    expect(signal?.reason).toStrictEqual(new Error('caller stopped'));
  });

  it('uses a Request signal when init does not supply one', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      new AbortController().signal,
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'));
    const request = new Request(TEST_URL, {
      signal: controller.signal,
    });

    await fetchWithTimeout(request);

    const signal = fetchMock.mock.calls[0]?.[1]?.signal;

    expect(signal?.reason).toBeUndefined();

    controller.abort();

    expect(signal?.reason).toBeDefined();
  });

  it('keeps the timeout signal active while the response body is being read', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          signal?.addEventListener('abort', () => {
            streamController.error(signal.reason);
          });
        },
      });

      return Promise.resolve(new Response(body));
    });

    const response = await fetchWithTimeout(TEST_URL);
    const responseBody = response.text();
    timeoutController.abort(new DOMException('Timed out', 'TimeoutError'));

    await expect(responseBody).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
