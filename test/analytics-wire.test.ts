/* eslint-disable camelcase -- Assertions use PostHog wire property names. */
import type { PostHog, PostHogOptions } from 'posthog-node';
import type * as PostHogSdk from 'posthog-node';

import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const revision = '0123456789abcdef0123456789abcdef01234567';
const sentinel = 'PRIVATE_ERROR_SENTINEL';
const clients: PostHog[] = [];
const bodies: string[] = [];
const blockedFetch = vi.fn<() => never>(() => {
  throw new Error('Unexpected network access');
});

beforeEach(async () => {
  vi.resetModules();
  bodies.length = 0;
  blockedFetch.mockClear();
  vi.stubGlobal('fetch', blockedFetch);
  vi.stubEnv('POSTHOG_KEY', 'fake-offline-key');
  vi.stubEnv('POSTHOG_HOST', 'https://analytics.example.test');
  vi.stubEnv('APP_REVISION', revision);
  const actual = await vi.importActual<typeof PostHogSdk>('posthog-node');
  vi.doMock('posthog-node', () => ({
    ...actual,
    PostHog: class extends actual.PostHog {
      public constructor(key: string, options: PostHogOptions) {
        super(key, {
          ...options,
          fetch: (_url, request) => {
            bodies.push(
              typeof request.body === 'string'
                ? request.body
                : gunzipSync(request.body as Uint8Array).toString('utf8'),
            );

            return Promise.resolve(new Response('{}', { status: 200 }));
          },
        });
        clients.push(this);
      }
    },
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: { error: vi.fn<() => void>() },
  }));
});

afterEach(async () => {
  const activeClients = [...clients];
  clients.length = 0;
  try {
    await Promise.all(
      activeClients.map(async (client) => client.shutdown(2_000)),
    );
  } finally {
    vi.doUnmock('posthog-node');
    vi.doUnmock('../src/utils/logger.js');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

test.each([
  ['error', Error],
  ['type_error', TypeError],
  ['range_error', RangeError],
  ['unknown', undefined],
] as const)(
  'serialized %s exception contains only categorical error data',
  async (category, Constructor) => {
    const analytics = await import('../src/utils/analytics.js');
    const error =
      Constructor === undefined
        ? sentinel
        : new Constructor(sentinel, {
            cause: new Error(`nested-${sentinel}`),
          });
    if (error instanceof Error) {
      error.stack = `Error: ${sentinel}\n    at privateFunction (/private/${sentinel}.js:42:7)`;
      Object.assign(error, {
        headers: { cookie: sentinel },
        url: `https://private.example/${sentinel}`,
      });
    }
    const properties = {
      app_revision: 'spoofed',
      cookie: sentinel,
      headers: { cookie: sentinel },
      phase: 'fetch' as const,
      reason: 'fetch_error' as const,
      runId: 'a32138bd-fd43-4974-a610-6c2673c5e4ae',
      source: 'announcements',
    };
    analytics.captureException(error, properties);
    await Promise.all(clients.map(async (client) => client.flush()));

    expect(blockedFetch).not.toHaveBeenCalled();
    expect(bodies.length).toBeGreaterThan(0);

    const events = bodies.flatMap(
      (body) =>
        (
          JSON.parse(body) as {
            batch: Array<{
              event: string;
              properties: Record<string, unknown>;
            }>;
          }
        ).batch,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      distinct_id: 'services-scraper',
      event: '$exception',
      properties: {
        $process_person_profile: false,
        app_revision: revision,
        category,
        phase: 'fetch',
        reason: 'fetch_error',
        run_id: properties.runId,
        service: 'services-scraper',
        source: 'announcements',
      },
    });
    expect(events[0]?.properties['$exception_list']).toStrictEqual([
      {
        mechanism: {
          exception_id: 0,
          handled: true,
          synthetic: false,
          type: 'generic',
        },
        stacktrace: { frames: [], type: 'raw' },
        type: 'Error',
        value: category,
      },
    ]);

    const wire = bodies.join('\n');
    for (const forbidden of [
      sentinel,
      'spoofed',
      'filename',
      'lineno',
      'colno',
      'context_line',
      'pre_context',
      'post_context',
      'privateFunction',
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  },
);
