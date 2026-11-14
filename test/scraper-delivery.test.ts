/* eslint-disable camelcase -- Assertions use PostHog wire property names. */
/* eslint-disable max-lines -- The scraper fixture and its behaviour tests are intentionally colocated. */
/* eslint-disable vitest/prefer-to-be-falsy -- Require literal false for person-profile suppression. */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { StrategyContext, StrategyResult } from '../src/lib/Scraper.js';

import { HttpError } from '../src/utils/http-error.js';

const stopScraperRegex = /stop scraper/u;
const stopScraperMessage = 'stop scraper';

beforeEach(() => {
  vi.stubEnv('POSTHOG_KEY', '');
  vi.stubEnv('POSTHOG_HOST', 'https://analytics.example.test');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('does not mark posts seen when webhook delivery fails', async () => {
  const commitCalls: string[] = [];
  const sendError = new Error('webhook down');

  vi.doMock('discord.js', () => ({
    codeBlock: (value: string) => `\`\`\`\n${value}\n\`\`\``,
    MessageFlagsBitField: {
      Flags: {
        IsComponentsV2: 32_768,
      },
    },
    roleMention: (roleId: string) => `<@&${roleId}>`,
    TextDisplayBuilder: class TextDisplayBuilder {
      private content = '';

      public setContent(content: string) {
        this.content = content;

        return this;
      }

      public toJSON() {
        return {
          content: this.content,
          type: 10,
        };
      }
    },
    WebhookClient: class WebhookClient {
      public send(): Promise<void> {
        return Promise.reject(sendError);
      }
    },
  }));

  vi.doMock('../src/configuration/config.js', () => ({
    getConfigProperty: (property: string) => {
      const config: Record<string, unknown> = {
        errorDelay: 1,
        errorWebhook: '',
        maxPosts: 20,
        scrapers: {
          delivery: {
            link: 'https://example.test/posts',
            strategy: 'delivery',
            webhook: 'https://discord.test/webhook',
          },
        },
        sendPosts: true,
        successDelay: 1,
        webhook: '',
      };

      return config[property];
    },
  }));

  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));

  vi.doMock('../src/utils/strategies.js', () => ({
    createStrategy: () => ({
      getChanges: (): Promise<StrategyResult> =>
        Promise.resolve({
          commit: () => {
            commitCalls.push('committed');
          },
          posts: [
            {
              component: {
                toJSON: () => ({
                  components: [],
                  type: 17,
                }),
              },
              id: 'post-1',
            },
          ],
        }),
    }),
  }));

  vi.doMock('../src/utils/webhooks.js', () => ({
    errorWebhook: undefined,
  }));

  const { Scraper } = await import('../src/Scraper.js');
  vi.spyOn(Scraper, 'sleep').mockRejectedValue(new Error(stopScraperMessage));

  const scraper = new Scraper('delivery');

  await expect(scraper.run()).rejects.toThrow(stopScraperRegex);
  expect(commitCalls).toStrictEqual([]);
});

test('commits cache migration when a strategy suppresses all posts', async () => {
  const commit = vi.fn<() => void>();

  vi.doMock('discord.js', () => ({
    codeBlock: (value: string) => `\`\`\`\n${value}\n\`\`\``,
    MessageFlagsBitField: { Flags: { IsComponentsV2: 32_768 } },
    roleMention: (roleId: string) => `<@&${roleId}>`,
    TextDisplayBuilder: class TextDisplayBuilder {
      public toJSON() {
        return { type: 10 };
      }
    },
    WebhookClient: class WebhookClient {
      public send(): Promise<void> {
        return Promise.resolve();
      }
    },
  }));
  vi.doMock('../src/configuration/config.js', () => ({
    getConfigProperty: (property: string) => {
      const config: Record<string, unknown> = {
        errorDelay: 1,
        errorWebhook: '',
        maxPosts: 20,
        scrapers: {
          migration: {
            link: 'https://finki.ukim.mk/wp-json/wp/v2/announcement',
            strategy: 'migration',
          },
        },
        sendPosts: true,
        successDelay: 1,
        webhook: '',
      };

      return config[property];
    },
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));
  vi.doMock('../src/utils/strategies.js', () => ({
    createStrategy: () => ({
      getChanges: (): Promise<StrategyResult> =>
        Promise.resolve({ commit, itemsFound: 20, posts: [] }),
    }),
  }));
  vi.doMock('../src/utils/webhooks.js', () => ({ errorWebhook: undefined }));

  const { Scraper } = await import('../src/Scraper.js');
  vi.spyOn(Scraper, 'sleep').mockRejectedValue(new Error(stopScraperMessage));
  const scraper = new Scraper('migration');

  await expect(scraper.run()).rejects.toThrow(stopScraperRegex);
  expect(commit).toHaveBeenCalledOnce();
});

const sentinel = 'SENTINEL-cookie-token-password-url';
const secretError = () =>
  new Error(sentinel, {
    cause: { config: { url: sentinel }, headers: { cookie: sentinel } },
  });

const setupRun = async (
  options: {
    accentColor?: number;
    count?: number;
    errorDelay?: number;
    oversized?: boolean | number;
    sendPosts?: boolean;
    stage?: 'acquire' | 'commit' | 'delivery' | 'fetch' | undefined;
    telemetryFails?: boolean;
    unknownError?: boolean;
    unserializable?: boolean;
    webhook?: boolean;
  } = {},
) => {
  type CapturedEvent = {
    distinctId: string;
    event: string;
    properties: Record<string, unknown>;
  };

  vi.stubEnv('POSTHOG_KEY', 'fake-test-key');
  const events: CapturedEvent[] = [];
  const exceptions = vi.fn<(...args: unknown[]) => void>();
  const sdkOptions = vi.fn<(config: unknown) => void>();
  const log = vi.fn<(...args: unknown[]) => void>();
  const errorSend = vi
    .fn<(payload: unknown) => Promise<void>>()
    .mockRejectedValue(secretError());
  const send = vi
    .fn<(payload: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  if (options.stage === 'delivery') {
    send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(secretError());
  }
  const commit = vi.fn<() => void>(() => {
    if (options.stage === 'commit') throw secretError();
  });
  const getCookie = vi.fn<() => Promise<string>>(() =>
    options.stage === 'acquire'
      ? Promise.reject(secretError())
      : Promise.resolve(sentinel),
  );
  const isOversized = (index: number): boolean =>
    options.oversized === true ||
    (typeof options.oversized === 'number' && index < options.oversized);
  const posts: StrategyResult['posts'] = Array.from(
    { length: options.count ?? 10 },
    (_, index) => ({
      component: {
        toJSON: () => {
          if (index === 0 && options.unserializable === true) {
            throw secretError();
          }

          return {
            components: isOversized(index)
              ? Array.from({ length: 40 }, () => ({ type: 10 }))
              : [],
            type: 17,
          } as never;
        },
      },
      id: `${sentinel}-${index}`,
    }),
  );
  const getChanges = vi.fn<
    (context: StrategyContext) => Promise<StrategyResult>
  >(() => {
    if (options.stage === 'fetch') {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Verify non-Error throws cannot leak their properties.
      return Promise.reject(
        options.unknownError ? { secret: sentinel } : secretError(),
      );
    }
    return Promise.resolve({
      commit,
      itemsFound: 50,
      posts,
    });
  });
  vi.doMock('posthog-node', () => ({
    PostHog: class {
      public constructor(_key: string, config: unknown) {
        sdkOptions(config);
      }
      public capture(event: CapturedEvent) {
        events.push(event);
        if (options.telemetryFails) throw secretError();
      }
      public captureException(...args: unknown[]) {
        exceptions(...args);
        if (options.telemetryFails) throw secretError();
      }
      public shutdown() {
        return Promise.reject(secretError());
      }
    },
  }));
  vi.doMock('discord.js', () => ({
    MessageFlagsBitField: { Flags: { IsComponentsV2: 32_768 } },
    WebhookClient: class {
      public send = send;
    },
  }));
  vi.doMock('../src/utils/components.js', () => ({
    createMentionComponent: vi.fn<() => void>(),
  }));
  vi.doMock('finki-auth', () => ({
    isCookieHeaderValid: vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValue(true),
  }));
  vi.doMock('../src/utils/strategies.js', () => ({
    createStrategy: () => ({
      getChanges,
      getCookie,
      scraperService: 'courses',
    }),
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: { error: log, info: log },
  }));
  vi.doMock('../src/utils/webhooks.js', () => ({
    errorWebhook: { send: errorSend },
  }));
  vi.doMock('../src/configuration/config.js', () => ({
    getConfigProperty: (property: string) =>
      ({
        errorDelay: options.errorDelay ?? 456,
        maxPosts: 20,
        scrapers: {
          delivery: {
            accentColor: options.accentColor,
            link: sentinel,
            strategy: 'delivery',
          },
        },
        sendPosts: options.sendPosts ?? true,
        successDelay: 123,
        webhook: options.webhook === false ? '' : 'https://discord.test/fake',
      })[property],
  }));
  const { Scraper } = await import('../src/Scraper.js');
  const sleep = vi
    .spyOn(Scraper, 'sleep')
    .mockRejectedValue(new Error(stopScraperMessage));
  const scraper = new Scraper('delivery');
  const run = async () => {
    await expect(scraper.run()).rejects.toThrow(stopScraperRegex);
  };
  const terminal = () =>
    events
      .filter((event) => event.event === 'scrape_run')
      .map((event) => event.properties);
  const notification = () =>
    events
      .filter((event) => event.event === 'notification_sent')
      .map((event) => event.properties);
  const assertSafe = () => {
    const errors = exceptions.mock.calls.map(([error]) => ({
      cause: (error as Error).cause,
      message: (error as Error).message,
      stack: (error as Error).stack,
    }));

    expect(
      JSON.stringify([
        events,
        exceptions.mock.calls,
        errors,
        log.mock.calls,
        errorSend.mock.calls,
      ]),
    ).not.toContain(sentinel);
  };
  return {
    assertSafe,
    commit,
    errorSend,
    events,
    exceptions,
    getChanges,
    getCookie,
    log,
    notification,
    posts,
    run,
    scraper,
    sdkOptions,
    send,
    sleep,
    terminal,
  };
};

test('forwards the configured accent color into the strategy context', async () => {
  const accentColor = 0x2a_93_d1;
  const fixture = await setupRun({ accentColor });
  await fixture.run();

  expect(fixture.getChanges).toHaveBeenCalledWith(
    expect.objectContaining({ accentColor }),
  );
});

test('missing webhook fails explicitly without delivery or checkpoint', async () => {
  const fixture = await setupRun({ webhook: false });
  await fixture.run();

  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.send).not.toHaveBeenCalled();
  expect(fixture.notification()).toStrictEqual([
    expect.objectContaining({
      count: 0,
      reason: 'missing_webhook',
      success: false,
    }),
  ]);
  expect(fixture.terminal()).toStrictEqual([
    expect.objectContaining({
      attempted: 0,
      confirmed_sent: 0,
      failed_attempted: 0,
      items_found: 50,
      items_new: 10,
      not_attempted: 10,
      phase: 'delivery',
      reason: 'missing_webhook',
      status: 'error',
    }),
  ]);
  expect(fixture.sleep).toHaveBeenCalledWith(456);

  fixture.assertSafe();
});

test('oversized post is rejected during preflight before any webhook send', async () => {
  const fixture = await setupRun({ oversized: true });
  await fixture.run();

  expect(fixture.getChanges).toHaveBeenCalledOnce();
  expect(fixture.send).not.toHaveBeenCalled();
  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.terminal()[0]).toMatchObject({
    attempted: 0,
    failed_attempted: 0,
    not_attempted: 0,
    phase: 'delivery',
    reason: 'delivery_error',
    skipped: 10,
  });
  expect(fixture.notification()).toStrictEqual([
    expect.objectContaining({
      attempted: 0,
      confirmed_sent: 0,
      failed_attempted: 0,
      not_attempted: 0,
      reason: 'delivery_error',
      skipped: 10,
      success: false,
    }),
  ]);
});

test('reports a partial delivery when an oversized post is skipped', async () => {
  const fixture = await setupRun({ oversized: 1 });
  await fixture.run();

  expect(fixture.send).toHaveBeenCalledTimes(3);
  expect(fixture.commit).toHaveBeenCalledOnce();
  expect(fixture.log).toHaveBeenCalledWith(
    '[delivery] Skipped 1 oversized post(s)',
  );
  expect(fixture.terminal()[0]).toMatchObject({
    attempted: 9,
    confirmed_sent: 9,
    failed_attempted: 0,
    items_new: 10,
    not_attempted: 0,
    outcome: 'partial',
    reason: 'skipped',
    skipped: 1,
    status: 'success',
  });
  expect(fixture.notification()).toStrictEqual([
    expect.objectContaining({
      attempted: 9,
      confirmed_sent: 9,
      count: 9,
      failed_attempted: 0,
      not_attempted: 0,
      reason: 'skipped',
      skipped: 1,
      success: true,
    }),
  ]);

  fixture.assertSafe();
});

test('fails preflight and refetches when a post cannot be serialized', async () => {
  const fixture = await setupRun({ unserializable: true });
  fixture.sleep.mockResolvedValueOnce(undefined);
  await fixture.run();

  expect(fixture.getChanges).toHaveBeenCalledTimes(2);
  expect(fixture.send).not.toHaveBeenCalled();
  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.terminal()[0]).toMatchObject({
    reason: 'delivery_error',
    skipped: 0,
    status: 'error',
  });
  expect(fixture.terminal()).toHaveLength(2);

  fixture.assertSafe();
});

test('refetches after an oversized preflight instead of retrying a wedged delivery', async () => {
  const fixture = await setupRun({ oversized: true });
  fixture.sleep.mockResolvedValueOnce(undefined);
  await fixture.run();

  expect(fixture.getChanges).toHaveBeenCalledTimes(2);
  expect(fixture.send).not.toHaveBeenCalled();
  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.terminal()).toHaveLength(2);

  fixture.assertSafe();
});

test('backs off repeated failures and throttles repeated error alerts', async () => {
  const fixture = await setupRun({ stage: 'fetch' });
  fixture.errorSend.mockResolvedValue(undefined);
  const delays: number[] = [];

  fixture.sleep.mockImplementation((ms: number) => {
    delays.push(ms);

    return delays.length >= 3
      ? Promise.reject(new Error(stopScraperMessage))
      : Promise.resolve();
  });

  await fixture.run();

  expect(delays).toStrictEqual([456, 912, 1_824]);
  expect(fixture.errorSend).toHaveBeenCalledOnce();

  fixture.assertSafe();
});

test('includes safe upstream status in error alerts', async () => {
  const fixture = await setupRun({ stage: 'fetch' });
  fixture.getChanges.mockRejectedValueOnce(
    new HttpError(503, 'upstream unavailable'),
  );

  await fixture.run();

  const [payload] = fixture.errorSend.mock.calls[0] as [{ content: string }];

  expect(payload.content).toContain('Details: status=503');

  fixture.assertSafe();
});

test('alerts once per failure reason and allows a different reason', async () => {
  const fixture = await setupRun({ count: 2, stage: 'fetch' });
  fixture.errorSend.mockResolvedValue(undefined);
  let attempts = 0;

  fixture.getChanges.mockImplementation(() => {
    attempts += 1;

    return attempts === 1
      ? Promise.reject(secretError())
      : Promise.resolve({ commit: fixture.commit, posts: fixture.posts });
  });
  fixture.send.mockRejectedValueOnce(secretError());
  const delays: number[] = [];

  fixture.sleep.mockImplementation((ms: number) => {
    delays.push(ms);

    return delays.length === 1
      ? Promise.resolve()
      : Promise.reject(new Error(stopScraperMessage));
  });

  await fixture.run();

  expect(delays).toStrictEqual([456, 912]);
  expect(fixture.errorSend).toHaveBeenCalledTimes(2);

  const messages = fixture.errorSend.mock.calls.map(
    ([payload]) => (payload as { content: string }).content,
  );

  expect(messages[0]).toContain('Reason: fetch_error');
  expect(messages[1]).toContain('Reason: delivery_error');

  fixture.assertSafe();
});

test('caps error backoff at fifteen minutes', async () => {
  const fixture = await setupRun({ errorDelay: 400_000, stage: 'fetch' });
  fixture.errorSend.mockResolvedValue(undefined);
  const delays: number[] = [];

  fixture.sleep.mockImplementation((ms: number) => {
    delays.push(ms);

    return delays.length >= 3
      ? Promise.reject(new Error(stopScraperMessage))
      : Promise.resolve();
  });

  await fixture.run();

  expect(delays).toStrictEqual([400_000, 800_000, 900_000]);

  fixture.assertSafe();
});

test('resets backoff and notifies once after recovery', async () => {
  const fixture = await setupRun({ count: 0, stage: 'fetch' });
  fixture.errorSend.mockResolvedValue(undefined);
  let attempts = 0;

  fixture.getChanges.mockImplementation(() => {
    attempts += 1;

    return attempts === 1
      ? Promise.reject(secretError())
      : Promise.resolve({ commit: fixture.commit, posts: [] });
  });
  const delays: number[] = [];
  let alertCallsAfterFirstSuccess: number | undefined;

  fixture.sleep.mockImplementation((ms: number) => {
    delays.push(ms);

    if (delays.length === 2) {
      alertCallsAfterFirstSuccess = fixture.errorSend.mock.calls.length;
    }

    return delays.length >= 3
      ? Promise.reject(new Error(stopScraperMessage))
      : Promise.resolve();
  });

  await fixture.run();

  expect(delays).toStrictEqual([456, 123, 123]);
  expect(alertCallsAfterFirstSuccess).toBe(1);
  expect(fixture.errorSend).toHaveBeenCalledTimes(2);

  const messages = fixture.errorSend.mock.calls.map(
    ([payload]) => (payload as { content: string }).content,
  );

  expect(messages[0]).toContain('❌ Error in **delivery**');
  expect(messages[1]).toContain('✅ Recovered in **delivery**');

  fixture.assertSafe();
});

test.each([
  { count: 10, outcome: 'disabled', remaining: 10, sendPosts: false },
  { count: 0, outcome: 'empty', remaining: 0, sendPosts: true },
])(
  'commits intentional $outcome without fabricated sends',
  async ({ count, outcome, remaining, sendPosts }) => {
    const fixture = await setupRun({ count, sendPosts, webhook: false });
    await fixture.run();

    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.send).not.toHaveBeenCalled();
    expect(fixture.notification()).toStrictEqual([]);
    expect(fixture.terminal()).toStrictEqual([
      expect.objectContaining({
        attempted: 0,
        confirmed_sent: 0,
        not_attempted: remaining,
        outcome,
        reason: outcome,
        status: 'success',
      }),
    ]);
    expect(fixture.sleep).toHaveBeenCalledWith(123);
  },
);

test('successful chunks count acknowledged sends and correlate all stages across distinct loops', async () => {
  const fixture = await setupRun();
  fixture.sleep.mockResolvedValueOnce(undefined);
  await fixture.run();

  expect(fixture.send).toHaveBeenCalledTimes(6);
  expect(fixture.commit).toHaveBeenCalledTimes(2);

  const runs = fixture.terminal();

  expect(runs).toHaveLength(2);
  expect(runs[0]?.['run_id']).not.toBe(runs[1]?.['run_id']);

  for (const run of runs) {
    expect(run).toMatchObject({
      attempted: 10,
      confirmed_sent: 10,
      failed_attempted: 0,
      not_attempted: 0,
      outcome: 'delivered',
      status: 'success',
    });
    expect(
      fixture.events
        .filter((event) => event.properties['run_id'] === run['run_id'])
        .map((event) => event.event),
    ).toStrictEqual([
      'scrape_started',
      'source_scraped',
      'notification_sent',
      'scrape_run',
    ]);
  }
  for (const event of fixture.events) {
    expect(event.distinctId).toBe('services-scraper');
    expect(event.properties['$process_person_profile']).toBe(false);
    expect(event.properties).not.toHaveProperty('sent');
    expect(event.properties).not.toHaveProperty('failed');
  }

  expect(fixture.sdkOptions).toHaveBeenCalledWith(
    expect.objectContaining({ enableExceptionAutocapture: false }),
  );

  fixture.assertSafe();
});

test('partial failure resumes at the failed batch without refetching', async () => {
  const fixture = await setupRun({ count: 9, stage: 'delivery' });
  await fixture.run();

  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.send).toHaveBeenCalledTimes(2);
  expect(fixture.getChanges).toHaveBeenCalledOnce();
  expect(fixture.notification()).toStrictEqual([
    expect.objectContaining({
      attempted: 8,
      confirmed_sent: 4,
      count: 4,
      failed_attempted: 4,
      not_attempted: 1,
      success: false,
    }),
  ]);
  expect(fixture.terminal()).toStrictEqual([
    expect.objectContaining({
      attempted: 8,
      confirmed_sent: 4,
      failed_attempted: 4,
      items_found: 50,
      items_new: 9,
      not_attempted: 1,
      phase: 'delivery',
      reason: 'delivery_error',
    }),
  ]);
  expect(fixture.exceptions).toHaveBeenCalledOnce();

  const { isCookieHeaderValid } = await import('finki-auth');
  vi.mocked(isCookieHeaderValid).mockRejectedValue(secretError());
  fixture.send.mockRejectedValueOnce(secretError());
  await fixture.run();

  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.send).toHaveBeenCalledTimes(3);
  expect(fixture.getChanges).toHaveBeenCalledOnce();
  expect(fixture.getCookie).toHaveBeenCalledOnce();
  expect(isCookieHeaderValid).not.toHaveBeenCalled();
  expect(fixture.send.mock.calls[1]).toStrictEqual(fixture.send.mock.calls[2]);
  expect(fixture.terminal()[1]).toMatchObject({
    attempted: 4,
    confirmed_sent: 0,
    failed_attempted: 4,
    not_attempted: 1,
  });

  await fixture.run();

  expect(fixture.commit).toHaveBeenCalledOnce();
  expect(fixture.send).toHaveBeenCalledTimes(5);
  expect(fixture.getChanges).toHaveBeenCalledOnce();
  expect(fixture.send.mock.calls[1]).toStrictEqual(fixture.send.mock.calls[2]);
  expect(fixture.send.mock.calls[2]).toStrictEqual(fixture.send.mock.calls[3]);
  expect(fixture.terminal()[2]).toMatchObject({
    attempted: 5,
    confirmed_sent: 5,
    not_attempted: 0,
    status: 'success',
  });

  fixture.assertSafe();
});

test('commit failure retry is commit-only and later polling fetches fresh changes', async () => {
  const fixture = await setupRun();
  fixture.commit.mockImplementationOnce(() => {
    throw secretError();
  });
  await fixture.run();

  expect(fixture.send).toHaveBeenCalledTimes(3);
  expect(fixture.commit).toHaveBeenCalledOnce();
  expect(fixture.getChanges).toHaveBeenCalledOnce();

  expect(fixture.terminal()[0]).toMatchObject({
    attempted: 10,
    confirmed_sent: 10,
    not_attempted: 0,
    phase: 'commit',
    reason: 'commit_error',
  });

  const { isCookieHeaderValid } = await import('finki-auth');
  vi.mocked(isCookieHeaderValid).mockRejectedValue(secretError());
  await fixture.run();

  expect(fixture.send).toHaveBeenCalledTimes(3);
  expect(fixture.commit).toHaveBeenCalledTimes(2);
  expect(fixture.getChanges).toHaveBeenCalledOnce();
  expect(fixture.getCookie).toHaveBeenCalledOnce();
  expect(isCookieHeaderValid).not.toHaveBeenCalled();

  vi.mocked(isCookieHeaderValid).mockResolvedValue(true);
  await fixture.run();

  expect(fixture.getChanges).toHaveBeenCalledTimes(2);
});

test.each([
  {
    known: false,
    phase: 'cookie_acquisition',
    reason: 'cookie_acquisition_error',
    stage: 'acquire' as const,
  },
  {
    known: false,
    phase: 'fetch',
    reason: 'fetch_error',
    stage: 'fetch' as const,
  },
  {
    known: true,
    phase: 'commit',
    reason: 'commit_error',
    stage: 'commit' as const,
  },
])(
  '$phase failure terminates once, safely, preserving known counts',
  async ({ known, phase, reason, stage }) => {
    const fixture = await setupRun({ stage });
    await fixture.run();

    expect(fixture.terminal()).toStrictEqual([
      expect.objectContaining({
        confirmed_sent: known ? 10 : 0,
        failed_attempted: 0,
        items_found: known ? 50 : null,
        items_new: known ? 10 : null,
        not_attempted: known ? 0 : null,
        phase,
        reason,
        status: 'error',
      }),
    ]);
    expect(fixture.exceptions).toHaveBeenCalledOnce();
    expect(fixture.errorSend).toHaveBeenCalledOnce();
    expect(fixture.sleep).toHaveBeenCalledWith(456);

    const deliveredNotification: unknown = expect.objectContaining({
      count: 10,
      success: true,
    });

    expect(fixture.notification()).toStrictEqual(
      known ? [deliveredNotification] : [],
    );

    fixture.assertSafe();
  },
);

test('cookie validation failure includes validation time and emits one correlated terminal', async () => {
  const fixture = await setupRun({ count: 0 });
  const { isCookieHeaderValid } = await import('finki-auth');
  vi.mocked(isCookieHeaderValid).mockRejectedValue(secretError());
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    clock += 10;
    return clock;
  });
  fixture.sleep.mockResolvedValueOnce(undefined);
  await fixture.run();

  expect(fixture.terminal()).toHaveLength(2);
  expect(fixture.terminal()[1]).toMatchObject({
    items_found: null,
    ms: 10,
    phase: 'cookie_validation',
    reason: 'cookie_validation_error',
    status: 'error',
  });
  expect(fixture.exceptions).toHaveBeenCalledOnce();
  expect(fixture.exceptions.mock.calls[0]?.[2]).toMatchObject({
    phase: 'cookie_validation',
    run_id: fixture.terminal()[1]?.['run_id'],
  });
  expect(fixture.sleep.mock.calls).toStrictEqual([[123], [456]]);

  fixture.assertSafe();
});

test('unknown errors are projected without serialization', async () => {
  const fixture = await setupRun({ stage: 'fetch', unknownError: true });
  await fixture.run();

  expect(fixture.exceptions.mock.calls[0]?.[2]).toMatchObject({
    category: 'unknown',
  });

  fixture.assertSafe();
});

test.each([undefined, 'delivery'] as const)(
  'telemetry failure is fail-open for %s outcome',
  async (stage) => {
    const fixture = await setupRun({ stage, telemetryFails: true });
    await fixture.run();

    expect(fixture.commit).toHaveBeenCalledTimes(stage === 'delivery' ? 0 : 1);
    expect(fixture.send).toHaveBeenCalledTimes(stage === 'delivery' ? 2 : 3);
    expect(fixture.terminal()).toHaveLength(1);

    fixture.assertSafe();
  },
);

test('does not claim delivery or commit while acknowledgement is pending', async () => {
  const fixture = await setupRun({ count: 4 });
  const entered = Promise.withResolvers<undefined>();
  const acknowledgement = Promise.withResolvers<undefined>();
  fixture.send.mockImplementationOnce(() => {
    entered.resolve(undefined);
    return acknowledgement.promise;
  });
  const running = fixture.run();
  await entered.promise;

  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.notification()).toStrictEqual([]);
  expect(fixture.terminal()).toStrictEqual([]);

  acknowledgement.resolve(undefined);
  await running;

  expect(fixture.commit).toHaveBeenCalledOnce();
  expect(fixture.terminal()[0]).toMatchObject({
    attempted: 4,
    confirmed_sent: 4,
    failed_attempted: 0,
    not_attempted: 0,
  });
});

test.each(['unhandledRejection', 'uncaughtException'] as const)(
  'global %s forwards only safe diagnostics even when notification and flush fail',
  async (eventName) => {
    const fixture = await setupRun();
    const closeCache = vi.fn<() => void>();
    vi.doMock('../src/utils/cache.js', () => ({ closeCache }));
    const on = vi.spyOn(process, 'on').mockReturnValue(process);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error(stopScraperMessage);
    });
    const { registerGlobalErrorHandlers } =
      await import('../src/utils/errors.js');
    registerGlobalErrorHandlers();
    const handler = on.mock.calls.find(
      ([event]) => event === eventName,
    )?.[1] as (error: unknown) => Promise<void>;
    let exitMessage: string | undefined;
    try {
      await handler(secretError());
    } catch (error) {
      exitMessage = (error as Error).message;
    }

    expect(exitMessage).toBe(
      eventName === 'uncaughtException' ? stopScraperMessage : undefined,
    );
    expect(closeCache).toHaveBeenCalledTimes(
      eventName === 'uncaughtException' ? 1 : 0,
    );
    expect(exit).toHaveBeenCalledTimes(
      eventName === 'uncaughtException' ? 1 : 0,
    );
    expect(fixture.exceptions).toHaveBeenCalledOnce();
    expect(fixture.errorSend).toHaveBeenCalledOnce();

    fixture.assertSafe();
  },
);

test('exception projection ignores arbitrary properties and hostile thrown values', async () => {
  const fixture = await setupRun();
  const { captureException } = await import('../src/utils/analytics.js');
  const properties = {
    cookie: sentinel,
    headers: { cookie: sentinel },
    phase: 'fetch' as const,
    reason: 'fetch_error' as const,
  };
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw secretError();
      },
    },
  );
  captureException(hostile, properties);
  captureException(sentinel, properties);

  expect(fixture.exceptions).toHaveBeenCalledTimes(2);

  for (const [error, distinctId, metadata] of fixture.exceptions.mock.calls) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).stack).toBe('Error: unknown');
    expect(metadata).toMatchObject({
      category: 'unknown',
      phase: 'fetch',
      reason: 'fetch_error',
    });
    expect(distinctId).toBe('services-scraper');
  }
  fixture.assertSafe();
});
