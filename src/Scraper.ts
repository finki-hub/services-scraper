import {
  type APIMessageTopLevelComponent,
  type JSONEncodable,
  MessageFlagsBitField,
  WebhookClient,
} from 'discord.js';
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
import { logger } from './utils/logger.js';
import { errorCategory } from './utils/safe-error.js';
import { createStrategy } from './utils/strategies.js';
import { errorWebhook } from './utils/webhooks.js';

export class Scraper {
  public get name() {
    return this.scraperName;
  }

  private cookie: string | undefined;

  private readonly logger: Logger;

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
        await this.validateCookie();
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

  private async getAndSendPosts(run: ScrapeRunEvent): Promise<void> {
    run.phase = 'cookie_acquisition';
    if (this.cookie === undefined && this.strategy.getCookie !== undefined) {
      this.cookie = await this.strategy.getCookie();
      logger.info(`[${this.scraperName}] ${LOG_MESSAGES.fetchedCookie}`);
    }

    run.phase = 'fetch';
    const maxPosts =
      this.scraperConfig.maxPosts ?? getConfigProperty('maxPosts');

    const scrapeStart = performance.now();
    let strategyResult: StrategyResult;

    try {
      strategyResult = await this.strategy.getChanges({
        cookie: this.cookie,
        link: this.scraperConfig.link,
        maxPosts,
        scraperId: this.scraperName,
      });
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

    const { commit, itemsFound, posts } = strategyResult;

    captureSourceScraped({
      durationMs: Math.round(performance.now() - scrapeStart),
      recordsAdded: posts.length,
      recordsTotal: itemsFound ?? posts.length,
      runId: run.runId,
      source: this.scraperName,
      success: true,
    });

    run.itemsFound = itemsFound ?? posts.length;
    run.itemsNew = posts.length;
    run.notAttempted = posts.length;

    if (posts.length === 0) {
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.noNewPosts}`);
      run.outcome = 'empty';
      run.reason = 'empty';
      run.phase = 'commit';
      commit();
      return;
    }

    const sendPosts = getConfigProperty('sendPosts');

    if (sendPosts) {
      run.phase = 'delivery';
      try {
        if (this.webhook === undefined) {
          run.reason = 'missing_webhook';
          throw new Error('missing_webhook');
        }
        await this.sendBatch(
          posts.map((post) => post.component),
          this.webhook,
          run,
        );
        captureNotificationSent({
          attempted: run.attempted,
          confirmedSent: run.confirmedSent,
          count: posts.length,
          failedAttempted: run.failedAttempted,
          notAttempted: run.notAttempted,
          reason: 'completed',
          runId: run.runId,
          source: this.scraperName,
          success: true,
        });
        logger.info(`[${this.scraperName}] ${LOG_MESSAGES.sentNewPosts}`);
      } catch (error) {
        captureNotificationSent({
          attempted: run.attempted,
          confirmedSent: run.confirmedSent,
          count: run.confirmedSent,
          failedAttempted: run.failedAttempted,
          notAttempted: run.notAttempted,
          reason:
            run.reason === 'missing_webhook'
              ? 'missing_webhook'
              : 'delivery_error',
          runId: run.runId,
          source: this.scraperName,
          success: false,
        });
        throw error;
      }
    }

    run.outcome = sendPosts ? 'delivered' : 'disabled';
    run.reason = sendPosts ? 'completed' : 'disabled';
    run.phase = 'commit';
    commit();
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

  private async sendBatch(
    components: Array<JSONEncodable<APIMessageTopLevelComponent>>,
    webhook: WebhookClient,
    run: ScrapeRunEvent,
  ): Promise<void> {
    if (components.length === 0) {
      return;
    }

    const mentionComponent =
      this.scraperConfig.role === undefined || this.scraperConfig.role === ''
        ? undefined
        : createMentionComponent(this.scraperConfig.role);

    // Discord allows 40 total components per message. The heaviest strategy
    // (Diplomas/Masters) builds ~9 components per post. 4 posts × 9 = 36,
    // plus 1 mention = 37. Well under the 40 limit.
    const chunkSize = 4;

    for (let index = 0; index < components.length; index += chunkSize) {
      const chunk = components.slice(index, index + chunkSize);
      const messageComponents = mentionComponent
        ? [mentionComponent, ...chunk]
        : chunk;

      try {
        run.attempted += chunk.length;
        run.notAttempted = components.length - run.attempted;
        await webhook.send({
          components: messageComponents,
          flags: MessageFlagsBitField.Flags.IsComponentsV2,
          username: this.scraperConfig.name ?? this.scraperName,
          withComponents: true,
        });
        run.confirmedSent += chunk.length;
      } catch (error) {
        // A rejected send means no confirmed acknowledgement, not proof of
        // non-delivery. Retrying the uncommitted run can duplicate earlier chunks.
        run.failedAttempted += chunk.length;
        throw error;
      }
    }
  }
}
