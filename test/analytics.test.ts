/* eslint-disable camelcase -- PostHog event properties use snake_case */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type * as Analytics from '../src/utils/analytics.js';

const revision = '0123456789abcdef0123456789abcdef01234567';
const service = 'services-scraper';
const runId = 'a32138bd-fd43-4974-a610-6c2673c5e4ae';
const exceptionProperties = {
  phase: 'fetch',
  reason: 'fetch_error',
  runId,
  source: 'announcements',
} as const;
const deliveryCounts = {
  attempted: 2,
  confirmedSent: 2,
  failedAttempted: 0,
  notAttempted: 0,
};
const wireCounts = {
  attempted: 2,
  confirmed_sent: 2,
  failed_attempted: 0,
  not_attempted: 0,
};
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
  const callerProperties = {
    app_revision: 'spoofed',
    runId,
    source: 'announcements',
  };
  analytics.captureScrapeStarted(callerProperties);
  analytics.captureNotificationSent({
    ...callerProperties,
    ...deliveryCounts,
    count: 2,
    reason: 'completed',
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
    ...deliveryCounts,
    itemsFound: 5,
    itemsNew: 2,
    ms: 20,
    outcome: 'delivered',
    phase: 'commit',
    reason: 'completed',
    source: 'announcements',
    status: 'success',
  });
};

test('adds the startup revision to every existing event without changing operational properties', async () => {
  const analytics = await import('../src/utils/analytics.js');
  vi.stubEnv('APP_REVISION', 'f'.repeat(40));
  emitEvents(analytics);

  const common = {
    $process_person_profile: false,
    app_revision: revision,
    run_id: runId,
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
        properties: {
          ...common,
          ...wireCounts,
          count: 2,
          reason: 'completed',
          success: true,
        },
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
          ...wireCounts,
          items_found: 5,
          items_new: 2,
          ms: 20,
          outcome: 'delivered',
          phase: 'commit',
          reason: 'completed',
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
    const properties = {
      ...exceptionProperties,
      app_revision: revision,
    };
    analytics.captureException(error, properties);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      service,
      {
        $process_person_profile: false,
        category: 'error',
        phase: 'fetch',
        reason: 'fetch_error',
        run_id: runId,
        service,
        source: 'announcements',
      },
    );
    expect(captureException.mock.calls[0]?.[0]).not.toBe(error);
    expect(captureException.mock.calls[0]?.[0]).not.toHaveProperty('stack');
    expect(captureException.mock.calls[0]?.[0]).toHaveProperty(
      'message',
      'error',
    );
  },
);

test.each(['f'.repeat(40), undefined])(
  'trusted exception revision wins over caller %s',
  async (value) => {
    const analytics = await import('../src/utils/analytics.js');
    const error = new Error('synthetic');
    const properties = {
      ...exceptionProperties,
      app_revision: value,
    };
    analytics.captureException(error, properties);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.any(Error),
      service,
      {
        $process_person_profile: false,
        app_revision: revision,
        category: 'error',
        phase: 'fetch',
        reason: 'fetch_error',
        run_id: runId,
        service,
        source: 'announcements',
      },
    );
    expect(captureException.mock.calls[0]?.[0]).not.toBe(error);
    expect(captureException.mock.calls[0]?.[0]).not.toHaveProperty('stack');
    expect(captureException.mock.calls[0]?.[0]).toHaveProperty(
      'message',
      'error',
    );
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
    analytics.captureException(new Error('synthetic'), exceptionProperties);
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
    analytics.captureException(error, exceptionProperties);
  }).not.toThrow();
  await expect(analytics.shutdownAnalytics()).resolves.toBeUndefined();
  expect(capture).toHaveBeenCalledTimes(4);
  expect(captureException).toHaveBeenCalledOnce();
  expect(loggerError).toHaveBeenCalledExactlyOnceWith(
    'Failed to flush PostHog analytics',
  );
});
