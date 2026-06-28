import {
  type APIMessageTopLevelComponent,
  codeBlock,
  type JSONEncodable,
  MessageFlagsBitField,
  WebhookClient,
} from 'discord.js';
import { isCookieHeaderValid } from 'finki-auth';
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
  captureScrapeRun,
  captureSourceScraped,
} from './utils/analytics.js';
import { createMentionComponent, truncateString } from './utils/components.js';
import { ERROR_MESSAGES, LOG_MESSAGES } from './utils/constants.js';
import { extractErrorCauses } from './utils/error-causes.js';
import { logger } from './utils/logger.js';
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
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.searching}`);

      try {
        await this.validateCookie();
      } catch (error) {
        await this.handleError(error, 'while validating cookie', this.cookie);
        this.cookie = undefined;
        await Scraper.sleep(getConfigProperty('errorDelay'));

        continue;
      }

      const start = performance.now();

      try {
        const { itemsFound, itemsNew } = await this.getAndSendPosts();
        captureScrapeRun({
          itemsFound,
          itemsNew,
          ms: Math.round(performance.now() - start),
          source: this.scraperName,
          status: 'success',
        });
      } catch (error) {
        captureScrapeRun({
          itemsFound: 0,
          itemsNew: 0,
          ms: Math.round(performance.now() - start),
          source: this.scraperName,
          status: 'error',
        });
        await this.handleError(error, 'while fetching and sending posts');
        await Scraper.sleep(getConfigProperty('errorDelay'));

        continue;
      }

      await Scraper.sleep(getConfigProperty('successDelay'));
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

  private async getAndSendPosts(): Promise<{
    itemsFound: number;
    itemsNew: number;
  }> {
    if (this.cookie === undefined && this.strategy.getCookie !== undefined) {
      try {
        this.cookie = await this.strategy.getCookie();
        logger.info(`[${this.scraperName}] ${LOG_MESSAGES.fetchedCookie}`);
      } catch (error) {
        throw new Error('Failed to fetch cookie', { cause: error });
      }
    }

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
        recordsChanged: null,
        recordsRemoved: null,
        recordsTotal: null,
        source: this.scraperName,
        success: false,
      });
      throw error;
    }

    const { commit, itemsFound, posts } = strategyResult;

    captureSourceScraped({
      durationMs: Math.round(performance.now() - scrapeStart),
      recordsAdded: posts.length,
      recordsChanged: null,
      recordsRemoved: null,
      recordsTotal: itemsFound ?? posts.length,
      source: this.scraperName,
      success: true,
    });

    const summary = {
      itemsFound: itemsFound ?? posts.length,
      itemsNew: posts.length,
    };

    if (posts.length === 0) {
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.noNewPosts}`);

      return summary;
    }

    for (const post of posts) {
      this.logger.info(
        `[${this.scraperName}] ${LOG_MESSAGES.postSent}: ${post.id ?? 'unknown'}`,
      );
    }

    const sendPosts = getConfigProperty('sendPosts');

    if (sendPosts) {
      await this.sendBatch(posts.map((post) => post.component));
      logger.info(`[${this.scraperName}] ${LOG_MESSAGES.sentNewPosts}`);
    }

    commit();

    return summary;
  }

  private async handleError(
    error: unknown,
    context?: string,
    code?: string,
  ): Promise<void> {
    captureException(error, {
      context,
      scraper: this.scraperName,
    });

    let errorMessage: string;
    let stackTrace: string | undefined;

    if (Error.isError(error)) {
      errorMessage = error.message;
      stackTrace = error.stack;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else {
      try {
        errorMessage = JSON.stringify(error);
      } catch {
        errorMessage = String(error);
      }
    }

    const causes = extractErrorCauses(error);
    const causesString = causes.length > 0 ? causes.join(' <- ') : null;
    const sourceUrl = this.scraperConfig.link;

    this.logger.error(
      `[${this.scraperName}] ${context ?? ''} ${sourceUrl} ${errorMessage}`,
    );

    if (causesString !== null) {
      this.logger.error(`Cause: ${causesString}`);
    }

    if (code) {
      this.logger.error(code);
    }

    if (stackTrace) {
      this.logger.error(stackTrace);
    }

    const webhookMessage = [
      `❌ Error in **${this.scraperName}**`,
      context ? `Context: ${context}` : null,
      `Source: ${sourceUrl}`,
      `Message: ${errorMessage}`,
      causesString ? `Cause: ${causesString}` : null,
      code ? codeBlock(truncateString(code, 1_000)) : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await (errorWebhook ?? this.webhook)?.send({
        content: webhookMessage,
        username: this.scraperConfig.name ?? this.scraperName,
      });
    } catch (error_) {
      this.logger.error(`Failed to send error to webhook: ${error_}`);
    }
  }

  private async sendBatch(
    components: Array<JSONEncodable<APIMessageTopLevelComponent>>,
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
        await this.webhook?.send({
          components: messageComponents,
          flags: MessageFlagsBitField.Flags.IsComponentsV2,
          username: this.scraperConfig.name ?? this.scraperName,
          withComponents: true,
        });
      } catch (error) {
        await this.handleError(
          error,
          `while sending batch of ${chunk.length} posts`,
        );

        throw error;
      }
    }
  }
}
