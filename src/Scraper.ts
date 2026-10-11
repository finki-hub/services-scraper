import { MessageFlagsBitField, WebhookClient } from 'discord.js';
import { isCookieHeaderValid } from 'finki-auth';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { type Logger } from 'pino';

import { getConfigProperty } from './configuration/config.js';
import {
  type ScraperConfig,
  type ScraperStrategy,
  type StrategyResult,
} from './lib/Scraper.js';
import {
  captureException,
  captureNotificationSent,
  captureScrapeRun,
  captureScrapeStarted,
  captureSourceScraped,
  type ScrapeRunEvent,
} from './utils/analytics.js';
import { createMentionComponent } from './utils/components.js';
import { ERROR_MESSAGES, LOG_MESSAGES } from './utils/constants.js';
import {
  type MaterializedBatch,
  materializeDeliveryBatches,
} from './utils/delivery.js';
import { logger } from './utils/logger.js';
import { errorCategory } from './utils/safe-error.js';
import { createStrategy } from './utils/strategies.js';
import { errorWebhook } from './utils/webhooks.js';

type PendingDelivery = {
  batches: MaterializedBatch[];
  commit: () => void;
  cursor: number;
  itemsFound: number;
  itemsNew: number;
  preflightError?: Error;
};

export class Scraper {
  public get name() {
    return this.scraperName;
  }

  private cookie: string | undefined;

  private readonly logger: Logger;

  private pendingDelivery: PendingDelivery | undefined;

  private readonly scraperConfig: ScraperConfig;

  private readonly scraperName: string;

  private readonly strategy: ScraperStrategy;

  private readonly webhook?: WebhookClient;

  public constructor(scraperName: string) {
    const scraper = getConfigProperty('scrapers')[scraperName];

    if (scraper === undefined) {
      throw new Error(`[${scraperName}] ${ERROR_MESSAGES.scraperNotFound}`);
    }

    this.scraperName = scraperName;
    this.scraperConfig = scraper;
    this.strategy = createStrategy(this.scraperConfig.strategy);
    this.logger = logger;

    const webhookUrl =
      this.scraperConfig.webhook ?? getConfigProperty('webhook');

    if (webhookUrl !== '') {
      this.webhook = new WebhookClient({ url: webhookUrl });
    }
  }

  public static async sleep(ms: number): Promise<void> {
    await setTimeout(ms);
  }

  public async run(): Promise<void> {
    while (true) {
      const start = performance.now();
      const run: ScrapeRunEvent = {
        attempted: 0,
        confirmedSent: 0,
        failedAttempted: 0,
        itemsFound: null,
        itemsNew: null,
        ms: 0,
        notAttempted: null,
        outcome: 'failed',
        phase: 'cookie_validation',
        reason: 'completed',
        runId: randomUUID(),
        source: this.scraperName,
        status: 'success',
      };
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.searching}`);
      captureScrapeStarted({ runId: run.runId, source: this.scraperName });

      try {
        if (this.pendingDelivery === undefined) {
          await this.validateCookie();
        }
        await this.getAndSendPosts(run);
      } catch (error) {
        run.status = 'error';
        run.outcome = 'failed';
        if (run.reason !== 'missing_webhook') {
          const reasons = {
            /* eslint-disable camelcase -- Fixed telemetry phase names. */
            commit: 'commit_error',
            cookie_acquisition: 'cookie_acquisition_error',
            cookie_validation: 'cookie_validation_error',
            delivery: 'delivery_error',
            fetch: 'fetch_error',
            /* eslint-enable camelcase -- Fixed telemetry phase names. */
          } as const;
          run.reason = reasons[run.phase];
        }
        if (run.phase === 'cookie_validation') this.cookie = undefined;
        await this.handleError(error, run);
      } finally {
        run.ms = Math.round(performance.now() - start);
        captureScrapeRun(run);
      }

      await Scraper.sleep(
        getConfigProperty(
          run.status === 'error' ? 'errorDelay' : 'successDelay',
        ),
      );
    }
  }

  public async validateCookie(): Promise<void> {
    const usesCookies = this.strategy.getCookie !== undefined;

    if (!usesCookies) {
      return;
    }

    const isValidCookie =
      this.strategy.scraperService !== undefined &&
      this.cookie !== undefined &&
      this.cookie !== '' &&
      (await isCookieHeaderValid({
        cookieHeader: this.cookie,
        service: this.strategy.scraperService,
      }));

    if (!isValidCookie) {
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.cookieInvalid}`);
      this.cookie = undefined;
    }
  }

  private captureDeliveryOutcome(run: ScrapeRunEvent, success: boolean): void {
    let reason: ScrapeRunEvent['reason'] = 'delivery_error';
    if (success) reason = 'completed';
    else if (run.reason === 'missing_webhook') reason = 'missing_webhook';
    captureNotificationSent({
      attempted: run.attempted,
      confirmedSent: run.confirmedSent,
      count: run.confirmedSent,
      failedAttempted: run.failedAttempted,
      notAttempted: run.notAttempted,
      reason,
      runId: run.runId,
      source: this.scraperName,
      success,
    });
  }

  private commitEmptyResult(run: ScrapeRunEvent, commit: () => void): void {
    this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.noNewPosts}`);
    run.outcome = 'empty';
    run.reason = 'empty';
    run.phase = 'commit';
    commit();
  }

  private commitPendingDelivery(
    run: ScrapeRunEvent,
    pending: PendingDelivery,
    sendPosts: boolean,
  ): void {
    run.outcome = sendPosts ? 'delivered' : 'disabled';
    run.reason = sendPosts ? 'completed' : 'disabled';
    run.phase = 'commit';
    pending.commit();
    this.pendingDelivery = undefined;
  }

  private countPendingPosts(pending: PendingDelivery): number {
    if (pending.batches.length === 0 && pending.cursor === 0) {
      return pending.itemsNew;
    }

    return pending.batches
      .slice(pending.cursor)
      .reduce((total, batch) => total + batch.postCount, 0);
  }

  private createPendingDelivery(
    result: StrategyResult,
    run: ScrapeRunEvent,
  ): PendingDelivery {
    const pending: PendingDelivery = {
      batches: [],
      commit: result.commit,
      cursor: 0,
      itemsFound: result.itemsFound ?? result.posts.length,
      itemsNew: result.posts.length,
    };
    this.pendingDelivery = pending;

    if (getConfigProperty('sendPosts')) {
      run.phase = 'delivery';
      try {
        const mention =
          this.scraperConfig.role === undefined ||
          this.scraperConfig.role === ''
            ? undefined
            : createMentionComponent(this.scraperConfig.role);
        pending.batches = materializeDeliveryBatches(
          result.posts.map((post) => post.component),
          mention,
        );
      } catch (error) {
        pending.preflightError =
          error instanceof Error
            ? error
            : new Error('delivery_preflight_error');
      }
    }

    return pending;
  }

  private async deliverPending(
    pending: PendingDelivery,
    run: ScrapeRunEvent,
  ): Promise<void> {
    try {
      if (pending.preflightError !== undefined) {
        throw pending.preflightError;
      }
      if (this.webhook === undefined) {
        run.reason = 'missing_webhook';
        throw new Error('missing_webhook');
      }
      await this.sendPendingBatches(pending, this.webhook, run);
      logger.info(`[${this.scraperName}] ${LOG_MESSAGES.sentNewPosts}`);
    } catch (error) {
      this.captureDeliveryOutcome(run, false);
      throw error;
    }
    this.captureDeliveryOutcome(run, true);
  }

  private async fetchStrategyResult(
    run: ScrapeRunEvent,
    maxPosts: number,
  ): Promise<StrategyResult> {
    const scrapeStart = performance.now();
    try {
      const result = await this.strategy.getChanges({
        cookie: this.cookie,
        link: this.scraperConfig.link,
        maxPosts,
        scraperId: this.scraperName,
      });
      captureSourceScraped({
        durationMs: Math.round(performance.now() - scrapeStart),
        recordsAdded: result.posts.length,
        recordsTotal: result.itemsFound ?? result.posts.length,
        runId: run.runId,
        source: this.scraperName,
        success: true,
      });
      return result;
    } catch (error) {
      captureSourceScraped({
        durationMs: Math.round(performance.now() - scrapeStart),
        recordsAdded: null,
        recordsTotal: null,
        runId: run.runId,
        source: this.scraperName,
        success: false,
      });
      throw error;
    }
  }

  private async getAndSendPosts(run: ScrapeRunEvent): Promise<void> {
    const maxPosts =
      this.scraperConfig.maxPosts ?? getConfigProperty('maxPosts');

    let pending = this.pendingDelivery;
    if (pending === undefined) {
      run.phase = 'cookie_acquisition';
      if (this.cookie === undefined && this.strategy.getCookie !== undefined) {
        this.cookie = await this.strategy.getCookie();
        logger.info(`[${this.scraperName}] ${LOG_MESSAGES.fetchedCookie}`);
      }

      run.phase = 'fetch';
      const strategyResult = await this.fetchStrategyResult(run, maxPosts);
      this.setFetchedRunCounts(run, strategyResult);
      if (strategyResult.posts.length === 0) {
        this.commitEmptyResult(run, strategyResult.commit);
        return;
      }

      pending = this.createPendingDelivery(strategyResult, run);
    } else {
      run.phase = 'fetch';
    }

    run.itemsFound = pending.itemsFound;
    run.itemsNew = pending.itemsNew;
    run.notAttempted = this.countPendingPosts(pending);
    const sendPosts = getConfigProperty('sendPosts');

    if (sendPosts) {
      run.phase = 'delivery';
      await this.deliverPending(pending, run);
    }

    this.commitPendingDelivery(run, pending, sendPosts);
  }

  private async handleError(
    error: unknown,
    run: ScrapeRunEvent,
  ): Promise<void> {
    captureException(error, {
      phase: run.phase,
      reason: run.reason,
      runId: run.runId,
      source: this.scraperName,
    });
    const category = errorCategory(error);
    const webhookMessage = [
      `❌ Error in **${this.scraperName}**`,
      `Run: ${run.runId}`,
      `Phase: ${run.phase}`,
      `Reason: ${run.reason}`,
      `Category: ${category}`,
    ].join('\n');
    this.logger.error(webhookMessage);

    try {
      await (errorWebhook ?? this.webhook)?.send({
        content: webhookMessage,
        username: this.scraperConfig.name ?? this.scraperName,
      });
    } catch {
      this.logger.error(
        `[${this.scraperName}] Run: ${run.runId} Failed to send error to webhook`,
      );
    }
  }

  private async sendPendingBatches(
    pending: PendingDelivery,
    webhook: WebhookClient,
    run: ScrapeRunEvent,
  ): Promise<void> {
    while (pending.cursor < pending.batches.length) {
      const batch = pending.batches[pending.cursor];
      if (batch === undefined) return;
      try {
        run.attempted += batch.postCount;
        run.notAttempted = Math.max(
          0,
          (run.notAttempted ?? 0) - batch.postCount,
        );
        await webhook.send({
          components: batch.components,
          flags: MessageFlagsBitField.Flags.IsComponentsV2,
          username: this.scraperConfig.name ?? this.scraperName,
          withComponents: true,
        });
        // Advance immediately after Discord acknowledges the message, before
        // analytics or other fallible work can interrupt this run.
        pending.cursor += 1;
        run.confirmedSent += batch.postCount;
      } catch (error) {
        run.failedAttempted += batch.postCount;
        throw error;
      }
    }
  }

  private setFetchedRunCounts(
    run: ScrapeRunEvent,
    result: StrategyResult,
  ): void {
    run.itemsFound = result.itemsFound ?? result.posts.length;
    run.itemsNew = result.posts.length;
    run.notAttempted = result.posts.length;
  }
}
