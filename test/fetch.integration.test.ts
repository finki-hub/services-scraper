import type { Socket } from 'node:net';

import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '../src/utils/fetch.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 1_000;
const TEST_DEADLINE_MS = 5_000;
const INTEGRATION_TEST_DEADLINE_MS = 10_000;
const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);

const deferred = <T = undefined>() => {
  let resolveDeferred!: (value: PromiseLike<T> | T) => void;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });

  return { promise, resolve: resolveDeferred };
};

const withinDeadline = async <T>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Timed out waiting for the loopback server'));
        }, TEST_DEADLINE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const createLoopbackHandler =
  (
    requestReceived: ReturnType<typeof deferred>,
    clientDisconnected: ReturnType<typeof deferred>,
  ) =>
  (request: IncomingMessage, response: ServerResponse) => {
    requestReceived.resolve(undefined);
    response.once('close', () => {
      clientDisconnected.resolve(undefined);
    });

    if (request.url === '/headers-stall') {
      return;
    }

    if (request.url === '/body-stall') {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.flushHeaders();
      response.write('partial response');
      return;
    }

    if (request.url === '/success') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString(),
            header: request.headers['x-test-header'],
            method: request.method,
          }),
        );
      });
    }
  };

const trackSocket =
  (sockets: Set<Socket>) =>
  (socket: Socket): void => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

describe('fetchWithTimeout over real HTTP', () => {
  let server: Server;
  let serverAddress: string;
  let requestReceived: ReturnType<typeof deferred>;
  let clientDisconnected: ReturnType<typeof deferred>;
  let sockets: Set<Socket>;

  beforeEach(async () => {
    requestReceived = deferred();
    clientDisconnected = deferred();
    sockets = new Set();
    server = createServer(
      createLoopbackHandler(requestReceived, clientDisconnected),
    );
    server.on('connection', trackSocket(sockets));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP address');
    }

    serverAddress = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();

      for (const socket of sockets) {
        socket.destroy();
      }

      await closed;
    }

    vi.restoreAllMocks();
  });

  it(
    'aborts a request that stalls before response headers',
    async () => {
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation((milliseconds) =>
          nativeTimeout(Math.min(milliseconds, TEST_TIMEOUT_MS)),
        );

      await expect(
        fetchWithTimeout(`${serverAddress}/headers-stall`),
      ).rejects.toMatchObject({ name: 'TimeoutError' });

      await withinDeadline(clientDisconnected.promise);

      expect(timeout).toHaveBeenCalledExactlyOnceWith(DEFAULT_TIMEOUT_MS);
    },
    INTEGRATION_TEST_DEADLINE_MS,
  );

  it(
    'aborts a response body that stalls after headers arrive',
    async () => {
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation((milliseconds) =>
          nativeTimeout(Math.min(milliseconds, TEST_TIMEOUT_MS)),
        );
      const response = await fetchWithTimeout(`${serverAddress}/body-stall`);

      await expect(response.text()).rejects.toMatchObject({
        name: 'TimeoutError',
      });

      await withinDeadline(clientDisconnected.promise);

      expect(timeout).toHaveBeenCalledExactlyOnceWith(DEFAULT_TIMEOUT_MS);
    },
    INTEGRATION_TEST_DEADLINE_MS,
  );

  it(
    'honors caller cancellation before the request timeout',
    async () => {
      let timeoutSignal: AbortSignal | undefined;
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation((milliseconds) => {
          timeoutSignal = nativeTimeout(
            Math.min(milliseconds, TEST_TIMEOUT_MS),
          );

          return timeoutSignal;
        });
      const controller = new AbortController();
      const request = fetchWithTimeout(`${serverAddress}/headers-stall`, {
        signal: controller.signal,
      });

      await withinDeadline(requestReceived.promise);
      controller.abort(new DOMException('Caller canceled', 'AbortError'));

      await expect(request).rejects.toMatchObject({ name: 'AbortError' });

      await withinDeadline(clientDisconnected.promise);

      expect(timeout).toHaveBeenCalledExactlyOnceWith(DEFAULT_TIMEOUT_MS);
      expect(timeoutSignal?.reason).toBeUndefined();
    },
    INTEGRATION_TEST_DEADLINE_MS,
  );

  it(
    'preserves normal method, body, and headers on a successful request',
    async () => {
      const response = await fetchWithTimeout(`${serverAddress}/success`, {
        body: 'integration payload',
        headers: { 'X-Test-Header': 'preserved' },
        method: 'POST',
      });

      await expect(response.json()).resolves.toStrictEqual({
        body: 'integration payload',
        header: 'preserved',
        method: 'POST',
      });
    },
    INTEGRATION_TEST_DEADLINE_MS,
  );
});
