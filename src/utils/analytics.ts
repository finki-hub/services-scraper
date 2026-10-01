/* eslint-disable camelcase -- PostHog wire properties use snake_case. */
import { setTimeout } from 'node:timers/promises';
import { PostHog } from 'posthog-node';

import { logger } from './logger.js';
import { errorCategory } from './safe-error.js';

const SERVICE_NAME = 'services-scraper';

const POSTHOG_KEY = process.env['POSTHOG_KEY'] ?? '';
const POSTHOG_HOST = process.env['POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';

const client =
  POSTHOG_KEY === ''
    ? undefined
    : new PostHog(POSTHOG_KEY, {
        disableGeoip: true,
        enableExceptionAutocapture: false,
        flushAt: 1,
        flushInterval: 0,
        host: POSTHOG_HOST,
      });

export type DeliveryCounts = {
  attempted: number;
  confirmedSent: number;
  failedAttempted: number;
  notAttempted: null | number;
};
export type NotificationSentEvent = DeliveryCounts & {
  count: number;
  reason: RunReason;
  runId: string;
  source: string;
  success: boolean;
};
export type RunPhase =
  | 'commit'
  | 'cookie_acquisition'
  | 'cookie_validation'
  | 'delivery'
  | 'fetch';

export type RunReason =
  | 'commit_error'
  | 'completed'
  | 'cookie_acquisition_error'
  | 'cookie_validation_error'
  | 'delivery_error'
  | 'disabled'
  | 'empty'
  | 'fetch_error'
  | 'missing_webhook';

export type ScrapeRunEvent = DeliveryCounts & {
  itemsFound: null | number;
  itemsNew: null | number;
  ms: number;
  outcome: 'delivered' | 'disabled' | 'empty' | 'failed';
  phase: RunPhase;
  reason: RunReason;
  runId: string;
  source: string;
  status: ScrapeRunStatus;
};

export type ScrapeRunStatus = 'error' | 'success';

export type ScrapeStartedEvent = {
  runId: string;
  source: string;
};

export type SourceScrapedEvent = {
  durationMs: number;
  recordsAdded: null | number;
  recordsTotal: null | number;
  runId: string;
  source: string;
  success: boolean;
};

export const captureScrapeStarted = (event: ScrapeStartedEvent): void => {
  try {
    client?.capture({
      distinctId: SERVICE_NAME,
      event: 'scrape_started',
      properties: {
        $process_person_profile: false,
        run_id: event.runId,
        service: SERVICE_NAME,
        source: event.source,
      },
    });
  } catch {}
};

export const captureNotificationSent = (event: NotificationSentEvent): void => {
  try {
    client?.capture({
      distinctId: SERVICE_NAME,
      event: 'notification_sent',
      properties: {
        $process_person_profile: false,
        attempted: event.attempted,
        confirmed_sent: event.confirmedSent,
        count: event.count,
        failed_attempted: event.failedAttempted,
        not_attempted: event.notAttempted,
        reason: event.reason,
        run_id: event.runId,
        service: SERVICE_NAME,
        source: event.source,
        success: event.success,
      },
    });
  } catch {}
};

export const captureSourceScraped = (event: SourceScrapedEvent): void => {
  try {
    client?.capture({
      distinctId: SERVICE_NAME,
      event: 'source_scraped',
      properties: {
        $process_person_profile: false,
        duration_ms: event.durationMs,
        records_added: event.recordsAdded,
        records_total: event.recordsTotal,
        run_id: event.runId,
        service: SERVICE_NAME,
        source: event.source,
        success: event.success,
      },
    });
  } catch {}
};

export const captureScrapeRun = (event: ScrapeRunEvent): void => {
  try {
    client?.capture({
      distinctId: SERVICE_NAME,
      event: 'scrape_run',
      properties: {
        $process_person_profile: false,
        attempted: event.attempted,
        confirmed_sent: event.confirmedSent,
        failed_attempted: event.failedAttempted,
        items_found: event.itemsFound,
        items_new: event.itemsNew,
        ms: event.ms,
        not_attempted: event.notAttempted,
        outcome: event.outcome,
        phase: event.phase,
        reason: event.reason,
        run_id: event.runId,
        service: SERVICE_NAME,
        source: event.source,
        status: event.status,
      },
    });
  } catch {}
};

export const captureException = (
  error: unknown,
  properties: {
    phase: 'recovery' | 'uncaught_exception' | 'unhandled_rejection' | RunPhase;
    reason: 'unexpected_error' | RunReason;
    runId?: string;
    source?: string;
  },
): void => {
  try {
    const category = errorCategory(error);
    const safeError = new Error(category);
    // eslint-disable-next-line e18e/no-delete-property -- Explicitly omit stack from the SDK input.
    delete safeError.stack;
    client?.captureException(safeError, SERVICE_NAME, {
      $process_person_profile: false,
      category,
      phase: properties.phase,
      reason: properties.reason,
      run_id: properties.runId,
      service: SERVICE_NAME,
      source: properties.source,
    });
  } catch {}
};

const SHUTDOWN_TIMEOUT_MS = 2_000;

export const shutdownAnalytics = async (): Promise<void> => {
  if (client === undefined) {
    return;
  }

  try {
    await Promise.race([client.shutdown(), setTimeout(SHUTDOWN_TIMEOUT_MS)]);
  } catch {
    logger.error('Failed to flush PostHog analytics');
  }
};
