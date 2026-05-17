import type { Cheerio, CheerioAPI } from 'cheerio';

import * as cheerio from 'cheerio';
import { type Element, isTag } from 'domhandler';
import { CasAuthentication, type Service } from 'finki-auth';

import type { PostData } from '../../lib/Post.js';
import type {
  ScraperStrategy,
  StrategyContext,
  StrategyResult,
} from '../../lib/Scraper.js';

import { getConfigProperty } from '../../configuration/config.js';
import { getSeenPostIds, markPostsSeen } from '../../utils/cache.js';
import { ERROR_MESSAGES } from '../../utils/constants.js';
import { logger } from '../../utils/logger.js';

const NO_CHANGES: StrategyResult = {
  commit: () => {},
  posts: [],
};

export abstract class HtmlStrategy implements ScraperStrategy {
  public abstract postsSelector: string;

  public async getCasAuthCookie(service: Service): Promise<string> {
    const credentials = getConfigProperty('credentials');

    if (credentials === undefined) {
      throw new Error(
        'Credentials are not defined. Please check your configuration.',
      );
    }

    const auth = new CasAuthentication(credentials);

    await auth.authenticate(service);

    return auth.buildCookieHeader(service);
  }

  public async getChanges(context: StrategyContext): Promise<StrategyResult> {
    const response = await this.fetchHtml(context);
    const $ = cheerio.load(response);

    const posts = this.getPostsFromDom($, context.maxPosts);
    const seenIds = getSeenPostIds(context.scraperId);
    const allIds = posts.map((post) => this.getId($(post)));

    if (allIds.every((id) => id === null || seenIds.has(id))) {
      return NO_CHANGES;
    }

    const newPosts: PostData[] = [];

    for (const post of posts.toReversed()) {
      const data = this.getPostData($(post));

      if (data.id === null) {
        logger.error(
          `[${context.scraperId}] Post ID not found: ${$.html(post).slice(0, 200)}`,
        );

        continue;
      }

      if (seenIds.has(data.id)) {
        continue;
      }

      newPosts.push(data);
    }

    return {
      commit: () => {
        markPostsSeen(context.scraperId, allIds);
      },
      posts: newPosts,
    };
  }

  public abstract getId($element: Cheerio<Element>): null | string;

  public abstract getPostData($element: Cheerio<Element>): PostData;

  public getRequestInit(cookie: string | undefined): RequestInit | undefined {
    if (cookie === undefined) {
      return undefined;
    }

    return {
      credentials: 'include',
      headers: {
        Cookie: cookie,
      },
    };
  }

  private async fetchHtml(context: StrategyContext): Promise<string> {
    const requestInit = this.getRequestInit(context.cookie);

    let response: Response;

    try {
      response = await fetch(context.link, requestInit);
    } catch (error) {
      throw new Error(ERROR_MESSAGES.fetchFailed, { cause: error });
    }

    if (response.status !== 200) {
      throw new Error(`${ERROR_MESSAGES.badResponseCode}: ${response.status}`);
    }

    try {
      return await response.text();
    } catch (error) {
      throw new Error(ERROR_MESSAGES.fetchParseFailed, { cause: error });
    }
  }

  private getPostsFromDom($: CheerioAPI, maxPosts: number): Element[] {
    const posts = $(this.postsSelector).toArray().filter(isTag);
    const lastPosts = posts.slice(0, maxPosts);

    if (lastPosts.length === 0) {
      throw new Error(ERROR_MESSAGES.postsNotFound);
    }

    return lastPosts;
  }
}
