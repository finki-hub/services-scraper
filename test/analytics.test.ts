/* eslint-disable camelcase -- PostHog event properties use snake_case */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Analytics from '../src/utils/analytics.js';

const revision = '0123456789abcdef0123456789abcdef01234567';
const service = 'services-scraper';
const capture = vi.fn<(...args: unknown[]) => void>();
const captureException = vi.fn<(...args: unknown[]) => void>();
const shutdown = vi.fn<() => Promise<void>>();
const loggerError = vi.fn<(...args: unknown[]) => void>();
const createClient = vi.fn<() => void>();

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('POSTHOG_KEY', 'test-key');
  vi.stubEnv('POSTHOG_HOST', 'https://example.test');
  vi.stubEnv('APP_REVISION', revision);
  vi.doMock('posthog-node', () => ({
    PostHog: class PostHog {
      public capture = capture;
      public captureException = captureException;
      public shutdown = shutdown;

      public constructor() {
        createClient();
      }
    },
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: { error: loggerError },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('posthog-node');
  vi.doUnmock('../src/utils/logger.js');
  vi.resetModules();
});

const emitEvents = (analytics: typeof Analytics): void => {
  const callerProperties = { app_revision: 'spoofed', source: 'announcements' };
  analytics.captureScrapeStarted(callerProperties);
  analytics.captureNotificationSent({
    ...callerProperties,
    count: 2,
    source: 'announcements',
    success: true,
  });
  analytics.captureSourceScraped({
    ...callerProperties,
    durationMs: 15,
    recordsAdded: 2,
    recordsTotal: 5,
    source: 'announcements',
    success: true,
  });
  analytics.captureScrapeRun({
    ...callerProperties,
    itemsFound: 5,
    itemsNew: 2,
    ms: 20,
    source: 'announcements',
    status: 'success',
  });
};

test('adds the startup revision to every existing event without changing operational properties', async () => {
  const analytics = await import('../src/utils/analytics.js');
  vi.stubEnv('APP_REVISION', 'f'.repeat(40));
  emitEvents(analytics);

  const common = {
    app_revision: revision,
    service,
    source: 'announcements',
  };

  expect(capture.mock.calls).toStrictEqual([
    [
      {
        distinctId: service,
        event: 'scrape_started',
        properties: common,
      },
    ],
    [
      {
        distinctId: service,
        event: 'notification_sent',
        properties: { ...common, count: 2, success: true },
      },
    ],
    [
      {
        distinctId: service,
        event: 'source_scraped',
        properties: {
          ...common,
          duration_ms: 15,
          records_added: 2,
          records_total: 5,
          success: true,
        },
      },
    ],
    [
      {
        distinctId: service,
        event: 'scrape_run',
        properties: {
          ...common,
          items_found: 5,
          items_new: 2,
          ms: 20,
          status: 'success',
        },
      },
    ],
  ]);
});

test.each([
  undefined,
  '',
  'main',
  revision.slice(0, 7),
  revision.toUpperCase(),
  'g'.repeat(40),
  ` ${revision}`,
  `${revision}\n`,
  `${revision}0`,
])(
  'omits missing or invalid revision %s and strips caller spoofing',
  async (value) => {
    vi.stubEnv('APP_REVISION', value);
    const analytics = await import('../src/utils/analytics.js');
    vi.stubEnv('APP_REVISION', revision);
    emitEvents(analytics);
    for (const [event] of capture.mock.calls) {
      expect(event).not.toHaveProperty('properties.app_revision');
    }
    const error = new Error('synthetic');
    analytics.captureException(error, {
      app_revision: revision,
      scraper: 'announcements',
    });

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, service, {
      scraper: 'announcements',
      service,
    });
  },
);

test.each(['f'.repeat(40), undefined])(
  'trusted exception revision wins over caller %s',
  async (value) => {
    const analytics = await import('../src/utils/analytics.js');
    const error = new Error('synthetic');
    const properties = {
      app_revision: value,
      context: 'while fetching',
      scraper: 'announcements',
    };
    analytics.captureException(error, properties);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, service, {
      ...properties,
      app_revision: revision,
      service,
    });
    expect(properties.app_revision).toBe(value);
  },
);

test('missing key disables all captures and shutdown', async () => {
  vi.stubEnv('POSTHOG_KEY', undefined);
  const analytics = await import('../src/utils/analytics.js');

  expect(() => {
    emitEvents(analytics);
  }).not.toThrow();
  expect(() => {
    analytics.captureException(new Error('synthetic'));
  }).not.toThrow();

  await analytics.shutdownAnalytics();

  expect(createClient).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  expect(captureException).not.toHaveBeenCalled();
  expect(shutdown).not.toHaveBeenCalled();
});

test('SDK capture and shutdown failures remain fail-open', async () => {
  const error = new Error('synthetic SDK failure');
  capture.mockImplementation(() => {
    throw error;
  });
  captureException.mockImplementation(() => {
    throw error;
  });
  shutdown.mockRejectedValue(error);
  const analytics = await import('../src/utils/analytics.js');

  expect(() => {
    emitEvents(analytics);
  }).not.toThrow();
  expect(() => {
    analytics.captureException(error);
  }).not.toThrow();
  await expect(analytics.shutdownAnalytics()).resolves.toBeUndefined();
  expect(capture).toHaveBeenCalledTimes(4);
  expect(captureException).toHaveBeenCalledOnce();
  expect(loggerError).toHaveBeenCalledExactlyOnceWith(
    { error },
    'Failed to flush PostHog analytics',
  );
});
