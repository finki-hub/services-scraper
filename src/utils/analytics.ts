import { PostHog } from 'posthog-node';

import { logger } from './logger.js';

const SERVICE_NAME = 'services-scraper';

const POSTHOG_KEY = process.env['POSTHOG_KEY'] ?? '';
const POSTHOG_HOST = process.env['POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';

const client =
  POSTHOG_KEY === ''
    ? undefined
    : new PostHog(POSTHOG_KEY, {
        disableGeoip: true,
        enableExceptionAutocapture: true,
        flushAt: 1,
        flushInterval: 0,
        host: POSTHOG_HOST,
      });

export type ScrapeRunEvent = {
  itemsFound: number;
  itemsNew: number;
  ms: number;
  source: string;
  status: ScrapeRunStatus;
};

export type ScrapeRunStatus = 'error' | 'success';

export type SourceScrapedEvent = {
  durationMs: number;
  recordsAdded: null | number;
  recordsChanged: null | number;
  recordsRemoved: null | number;
  recordsTotal: null | number;
  source: string;
  success: boolean;
};

export const captureSourceScraped = (event: SourceScrapedEvent): void => {
  client?.capture({
    distinctId: SERVICE_NAME,
    event: 'source_scraped',
    properties: {
      /* eslint-disable camelcase -- PostHog event properties use snake_case */
      duration_ms: event.durationMs,
      records_added: event.recordsAdded,
      records_changed: event.recordsChanged,
      records_removed: event.recordsRemoved,
      records_total: event.recordsTotal,
      /* eslint-enable camelcase -- PostHog event properties use snake_case */
      source: event.source,
      success: event.success,
    },
  });
};

export const captureScrapeRun = (event: ScrapeRunEvent): void => {
  client?.capture({
    distinctId: SERVICE_NAME,
    event: 'scrape_run',
    properties: {
      /* eslint-disable camelcase -- PostHog event properties use snake_case */
      items_found: event.itemsFound,
      items_new: event.itemsNew,
      /* eslint-enable camelcase -- PostHog event properties use snake_case */
      ms: event.ms,
      service: SERVICE_NAME,
      source: event.source,
      status: event.status,
    },
  });
};

export const captureException = (
  error: unknown,
  properties?: Record<string, unknown>,
): void => {
  try {
    client?.captureException(error, SERVICE_NAME, {
      service: SERVICE_NAME,
      ...properties,
    });
  } catch {
    // no-op: analytics must never throw
  }
};

export const shutdownAnalytics = async (): Promise<void> => {
  if (client === undefined) {
    return;
  }

  try {
    await client.shutdown();
  } catch (error) {
    logger.error({ error }, 'Failed to flush PostHog analytics');
  }
};
