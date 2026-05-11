import type { CheerioAPI } from 'cheerio';

import * as cheerio from 'cheerio';
import {
  type APIMessageTopLevelComponent,
  codeBlock,
  type JSONEncodable,
  MessageFlagsBitField,
  WebhookClient,
} from 'discord.js';
import { type Element, isTag } from 'domhandler';
import { isCookieHeaderValid } from 'finki-auth';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { type Logger } from 'pino';

import { getConfigProperty } from './configuration/config.js';
import { type ScraperConfig, type ScraperStrategy } from './lib/Scraper.js';
import { createMentionComponent, truncateString } from './utils/components.js';
import { CACHE_PATH, ERROR_MESSAGES, LOG_MESSAGES } from './utils/constants.js';
import { extractErrorCauses } from './utils/errors.js';
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

  public checkStatusCode(statusCode: number): void {
    if (statusCode === 401) {
      throw new Error(`${ERROR_MESSAGES.badResponseCode}: ${statusCode}`);
    }

    if (statusCode !== 200) {
      throw new Error(`${ERROR_MESSAGES.badResponseCode}: ${statusCode}`);
    }
  }

  public getFullCachePath(): string {
    return `./${CACHE_PATH}/${this.scraperName}`;
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

      try {
        await this.getAndSendPosts(true);
      } catch (error) {
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

  private async fetchData(): Promise<Response> {
    try {
      return await fetch(
        this.scraperConfig.link,
        this.strategy.getRequestInit?.(this.cookie),
      );
    } catch (error) {
      throw new Error(ERROR_MESSAGES.fetchFailed, {
        cause: error,
      });
    }
  }

  private async getAndSendPosts(
    checkCache: boolean,
  ): Promise<Array<JSONEncodable<APIMessageTopLevelComponent>>> {
    if (this.cookie === undefined && this.strategy.getCookie !== undefined) {
      try {
        this.cookie = await this.strategy.getCookie();
        logger.info(`[${this.scraperName}] ${LOG_MESSAGES.fetchedCookie}`);
      } catch (error) {
        throw new Error('Failed to fetch cookie', { cause: error });
      }
    }

    const response = await this.fetchData();

    this.checkStatusCode(response.status);

    const text = await this.getTextFromResponse(response);

    const $ = cheerio.load(text);

    const cache = await this.readCacheFile();
    const posts = this.getPostsFromDOM($);
    const ids = this.getIdsFromPosts($, posts);

    if (checkCache && this.hasNoNewPosts(ids, cache)) {
      this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.noNewPosts}`);

      return [];
    }

    const validPosts = await this.processNewPosts({
      $,
      cache,
      checkCache,
      posts,
    });
    await this.writeCacheFile(ids);

    const sendPosts = getConfigProperty('sendPosts');

    if (sendPosts) {
      logger.info(`[${this.scraperName}] ${LOG_MESSAGES.sentNewPosts}`);
    }

    return validPosts;
  }

  private getIdsFromPosts(
    $: CheerioAPI,
    posts: Element[],
  ): Array<null | string> {
    return posts.map((post) => this.strategy.getId($(post)));
  }

  private getPostsFromDOM($: ReturnType<typeof cheerio.load>): Element[] {
    const posts = $(this.strategy.postsSelector).toArray().filter(isTag);

    const maxPosts =
      this.scraperConfig.maxPosts ?? getConfigProperty('maxPosts');

    const lastPosts = posts.slice(0, maxPosts);

    if (lastPosts.length === 0) {
      throw new Error(ERROR_MESSAGES.postsNotFound);
    }

    return lastPosts;
  }

  private async getTextFromResponse(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw new Error(ERROR_MESSAGES.fetchParseFailed, {
        cause: error,
      });
    }
  }

  private async handleError(
    error: unknown,
    context?: string,
    code?: string,
  ): Promise<void> {
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

  private hasNoNewPosts(ids: Array<null | string>, cache: string[]) {
    return (
      ids.length === cache.length &&
      ids.every((value) => value === null || cache.includes(value))
    );
  }

  private async processNewPosts(options: {
    $: CheerioAPI;
    cache: string[];
    checkCache: boolean;
    posts: Element[];
  }): Promise<Array<JSONEncodable<APIMessageTopLevelComponent>>> {
    const { $, cache, checkCache, posts } = options;
    const allPosts = this.strategy.filterPosts?.(posts) ?? posts.toReversed();
    const validPosts: Array<JSONEncodable<APIMessageTopLevelComponent>> = [];
    const sendPosts = getConfigProperty('sendPosts');

    for (const post of allPosts) {
      const { component, id } = this.strategy.getPostData($(post));

      if (id === null) {
        await this.handleError(
          ERROR_MESSAGES.postIdNotFound,
          'while extracting post ID',
          $.html(post),
        );

        continue;
      }

      if (checkCache && cache.includes(id)) {
        this.logger.info(
          `[${this.scraperName}] ${LOG_MESSAGES.postAlreadySent}: ${id}`,
        );

        continue;
      }

      validPosts.push(component);

      if (sendPosts) {
        try {
          await this.sendPost(component, id);
        } catch (error) {
          await this.handleError(
            error,
            `while sending post: ${id}`,
            JSON.stringify(component.toJSON(), null, 2),
          );
        }
      }
    }

    return validPosts;
  }

  private async readCacheFile(): Promise<string[]> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
    if (!existsSync(CACHE_PATH)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
      await mkdir(CACHE_PATH, {
        recursive: true,
      });
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is derived from controlled scraper name
    const content = await readFile(this.getFullCachePath(), {
      encoding: 'utf8',
      flag: 'a+',
    });

    return content.trim().split('\n').filter(Boolean);
  }

  private async sendPost(
    component: JSONEncodable<APIMessageTopLevelComponent>,
    id: string,
  ): Promise<void> {
    await this.webhook?.send({
      components: [
        ...(this.scraperConfig.role === undefined ||
        this.scraperConfig.role === ''
          ? []
          : [createMentionComponent(this.scraperConfig.role)]),
        component,
      ],
      flags: MessageFlagsBitField.Flags.IsComponentsV2,
      username: this.scraperConfig.name ?? this.scraperName,
      withComponents: true,
    });
    this.logger.info(`[${this.scraperName}] ${LOG_MESSAGES.postSent}: ${id}`);
  }

  private async writeCacheFile(ids: Array<null | string>): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is derived from controlled scraper name
    await writeFile(this.getFullCachePath(), ids.join('\n'), {
      encoding: 'utf8',
      flag: 'w',
    });
  }
}
