import * as cheerio from 'cheerio';
import {
  ContainerBuilder,
  escapeMarkdown,
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

import {
  getSeenPostIds,
  getSnapshot,
  markPostsSeen,
  setSnapshot,
} from '../../utils/cache.js';
import { truncateString } from '../../utils/components.js';
import { ERROR_MESSAGES } from '../../utils/constants.js';

const FinkiUrlSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) => url.protocol === 'https:' && url.hostname === 'finki.ukim.mk',
    'Expected an HTTPS finki.ukim.mk URL',
  )
  .transform((url) =>
    url.href
      .replaceAll('(', '%28')
      .replaceAll(')', '%29')
      .replaceAll('[', '%5B')
      .replaceAll(']', '%5D'),
  );
const RenderedSchema = z.object({ rendered: z.string() });
const WordPressItemSchema = z.object({
  _embedded: z
    .object({
      'wp:featuredmedia': z
        .array(
          z.object({
            // eslint-disable-next-line camelcase -- WordPress REST API field name
            source_url: FinkiUrlSchema,
          }),
        )
        .optional(),
    })
    .optional(),
  content: RenderedSchema.optional(),
  id: z.number().int(),
  link: FinkiUrlSchema,
  title: RenderedSchema,
});
const WordPressItemsSchema = z.array(WordPressItemSchema);

type WordPressItem = z.infer<typeof WordPressItemSchema>;

const API_BASE_URL = 'https://finki.ukim.mk/wp-json/wp/v2';
const MAX_PAGE_SIZE = 100;
const MIGRATION_SNAPSHOT_KEY = 'wordpress-rest-migrated';

const plainText = (html: string): string =>
  cheerio.load(html).root().text().replaceAll(/\s+/gu, ' ').trim();

const escapeDiscordText = (text: string): string =>
  escapeMarkdown(
    text
      .replaceAll('[', '［')
      .replaceAll(']', '］')
      .replaceAll('(', '（')
      .replaceAll(')', '）'),
    {
      bulletedList: true,
      heading: true,
      maskedLink: true,
      numberedList: true,
    },
  ).replaceAll('@', '@\u{200B}');

export abstract class WordPressStrategy implements ScraperStrategy {
  public abstract collection: string;

  public includeContent = true;

  public async getChanges(context: StrategyContext): Promise<StrategyResult> {
    const items = await this.fetchItems(context.maxPosts);
    const seenIds = getSeenPostIds(context.scraperId);
    const ids = items.map((item) => this.getId(item));
    const isMigrated =
      getSnapshot(context.scraperId, MIGRATION_SNAPSHOT_KEY) === '1';
    const posts =
      seenIds.size > 0 && !isMigrated
        ? []
        : items
            .filter((item) => !seenIds.has(this.getId(item)))
            .toReversed()
            .map((item) => this.getPostData(item));

    return {
      commit: () => {
        markPostsSeen(context.scraperId, ids);
        setSnapshot(context.scraperId, MIGRATION_SNAPSHOT_KEY, '1');
      },
      itemsFound: items.length,
      posts,
    };
  }

  protected getPostData(item: WordPressItem): PostData {
    const title = escapeDiscordText(truncateString(this.getTitle(item)));
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
          content === ''
            ? 'Нема опис.'
            : escapeDiscordText(truncateString(content)),
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
      id: this.getId(item),
    };
  }

  private async fetchItems(maxPosts: number): Promise<WordPressItem[]> {
    const items: WordPressItem[] = [];

    while (items.length < maxPosts) {
      const pageSize = Math.min(MAX_PAGE_SIZE, maxPosts - items.length);
      const url = `${API_BASE_URL}/${this.collection}?per_page=${pageSize}&offset=${items.length}&_embed=1`;
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
    }

    if (items.length === 0) {
      throw new Error(ERROR_MESSAGES.postsNotFound);
    }

    return items;
  }

  private getId(item: WordPressItem): string {
    return `wordpress:${this.collection}:${item.id}`;
  }

  private getTitle(item: WordPressItem): string {
    return plainText(item.title.rendered) || '?';
  }
}
