import * as cheerio from 'cheerio';
import {
  ContainerBuilder,
  heading,
  hyperlink,
  TextDisplayBuilder,
} from 'discord.js';
import { z } from 'zod';

import type { PostData } from '../../lib/Post.js';
import type {
  ScraperStrategy,
  StrategyContext,
  StrategyResult,
} from '../../lib/Scraper.js';

import { getSeenPostIds, markPostsSeen } from '../../utils/cache.js';
import { truncateString } from '../../utils/components.js';
import { ERROR_MESSAGES } from '../../utils/constants.js';

const RenderedSchema = z.object({ rendered: z.string() });
const WordPressItemSchema = z.object({
  _embedded: z
    .object({
      'wp:featuredmedia': z
        .array(
          z.object({
            // eslint-disable-next-line camelcase -- WordPress REST API field name
            source_url: z.url(),
          }),
        )
        .optional(),
    })
    .optional(),
  content: RenderedSchema.optional(),
  id: z.number().int(),
  link: z.url(),
  title: RenderedSchema,
});
const WordPressItemsSchema = z.array(WordPressItemSchema);

type WordPressItem = z.infer<typeof WordPressItemSchema>;

const API_BASE_URL = 'https://finki.ukim.mk/wp-json/wp/v2';
const MAX_PAGE_SIZE = 100;

const plainText = (html: string): string =>
  cheerio.load(html).root().text().replaceAll(/\s+/gu, ' ').trim();

export abstract class WordPressStrategy implements ScraperStrategy {
  public abstract collection: string;

  public includeContent = true;

  public async getChanges(context: StrategyContext): Promise<StrategyResult> {
    const items = await this.fetchItems(context.maxPosts);
    const seenIds = getSeenPostIds(context.scraperId);
    const ids = items.map(({ link }) => link);
    const hasCanonicalIds = ids.some((id) => seenIds.has(id));
    const posts =
      seenIds.size > 0 && !hasCanonicalIds
        ? []
        : items
            .filter((item) => !seenIds.has(item.link))
            .toReversed()
            .map((item) => this.getPostData(item));

    return {
      commit: () => {
        markPostsSeen(context.scraperId, ids);
      },
      itemsFound: items.length,
      posts,
    };
  }

  protected getPostData(item: WordPressItem): PostData {
    const title = truncateString(this.getTitle(item));
    const textDisplayComponents = [
      new TextDisplayBuilder().setContent(
        this.includeContent
          ? heading(hyperlink(title, item.link), 3)
          : heading(hyperlink(title, item.link), 2),
      ),
    ];

    if (this.includeContent) {
      const content = plainText(item.content?.rendered ?? '');
      textDisplayComponents.push(
        new TextDisplayBuilder().setContent(
          content === '' ? 'Нема опис.' : truncateString(content),
        ),
      );
    }

    const image = item._embedded?.['wp:featuredmedia']?.[0]?.source_url;

    return {
      component:
        image === undefined
          ? new ContainerBuilder().addTextDisplayComponents(
              textDisplayComponents,
            )
          : new ContainerBuilder().addSectionComponents((section) =>
              section
                .addTextDisplayComponents(textDisplayComponents)
                .setThumbnailAccessory((thumbnail) => thumbnail.setURL(image)),
            ),
      id: item.link,
    };
  }

  private async fetchItems(maxPosts: number): Promise<WordPressItem[]> {
    const items: WordPressItem[] = [];
    let page = 1;

    while (items.length < maxPosts) {
      const pageSize = Math.min(MAX_PAGE_SIZE, maxPosts - items.length);
      const url = `${API_BASE_URL}/${this.collection}?per_page=${pageSize}&page=${page}&_embed=1`;
      let response: Response;

      try {
        response = await fetch(url);
      } catch (error) {
        throw new Error(ERROR_MESSAGES.fetchFailed, { cause: error });
      }

      if (!response.ok) {
        throw new Error(
          `${ERROR_MESSAGES.badResponseCode}: ${response.status}`,
        );
      }

      const pageItems = WordPressItemsSchema.parse(await response.json());
      items.push(...pageItems);

      if (pageItems.length < pageSize) {
        break;
      }

      page += 1;
    }

    return items;
  }

  private getTitle(item: WordPressItem): string {
    return plainText(item.title.rendered) || '?';
  }
}
