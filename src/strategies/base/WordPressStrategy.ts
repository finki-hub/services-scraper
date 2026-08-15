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
  getLatestLegacySeenAt,
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
const DATE_TIME_ZONE_REGEX = /[Z+-]/u;
const WordPressDateSchema = z.iso
  .datetime({ local: true })
  .transform((value) =>
    Math.floor(
      // eslint-disable-next-line unicorn/prefer-temporal -- Temporal is unavailable in the supported Node runtime
      Date.parse(
        DATE_TIME_ZONE_REGEX.test(value.slice(10)) ? value : `${value}Z`,
      ) / 1_000,
    ),
  )
  .pipe(z.number());
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
  // eslint-disable-next-line camelcase -- WordPress REST API field name
  date_gmt: WordPressDateSchema,
  id: z.number().int(),
  link: FinkiUrlSchema,
  title: RenderedSchema,
});
const WordPressItemsSchema = z.array(WordPressItemSchema);
const WordPressTotalSchema = z.coerce.number().int().nonnegative();

type WordPressItem = z.infer<typeof WordPressItemSchema>;
type WordPressPage = {
  readonly items: WordPressItem[];
  readonly total: number | undefined;
};

const API_BASE_URL = 'https://finki.ukim.mk/wp-json/wp/v2';
const MAX_PAGE_SIZE = 100;
const MIGRATION_SNAPSHOT_KEY = 'wordpress-rest-cutover';
const MigrationCutoffSchema = z.coerce.number().int().nonnegative();
const PAGINATION_CHANGED_ERROR =
  'WordPress collection changed during pagination';
const PAGINATION_REPEATED_ERROR = 'WordPress repeated a pagination page';

const validatePaginationPage = (
  page: WordPressPage,
  collectionTotal: number | undefined,
  pageFingerprints: Set<string>,
): number | undefined => {
  if (
    collectionTotal !== undefined &&
    page.total !== undefined &&
    collectionTotal !== page.total
  ) {
    throw new Error(PAGINATION_CHANGED_ERROR);
  }

  const pageFingerprint = page.items.map(({ id }) => id).join(',');

  if (pageFingerprints.has(pageFingerprint)) {
    throw new Error(PAGINATION_REPEATED_ERROR);
  }

  pageFingerprints.add(pageFingerprint);

  return collectionTotal ?? page.total;
};

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
    const seenIds = getSeenPostIds(context.scraperId);
    const savedCutoff = getSnapshot(context.scraperId, MIGRATION_SNAPSHOT_KEY);
    const isInitialMigration = savedCutoff === undefined;
    const migrationCutoff = isInitialMigration
      ? getLatestLegacySeenAt(context.scraperId)
      : MigrationCutoffSchema.parse(savedCutoff);
    const items = await this.fetchItems(
      context.maxPosts,
      isInitialMigration ? migrationCutoff : undefined,
    );
    const ids = items.map((item) => this.getId(item));
    const posts = items
      .filter(
        (item) =>
          !seenIds.has(this.getId(item)) &&
          (migrationCutoff === undefined || item.date_gmt > migrationCutoff),
      )
      .toReversed()
      .map((item) => this.getPostData(item));

    return {
      commit: () => {
        markPostsSeen(context.scraperId, ids);

        if (isInitialMigration && migrationCutoff !== undefined) {
          setSnapshot(
            context.scraperId,
            MIGRATION_SNAPSHOT_KEY,
            String(migrationCutoff),
          );
        }
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

  private async fetchItems(
    maxPosts: number,
    migrationCutoff: number | undefined,
  ): Promise<WordPressItem[]> {
    const items = new Map<string, WordPressItem>();
    const pageFingerprints = new Set<string>();
    let collectionTotal: number | undefined;
    let offset = 0;

    while (true) {
      if (migrationCutoff === undefined && items.size >= maxPosts) {
        break;
      }

      const pageSize =
        migrationCutoff === undefined
          ? Math.min(MAX_PAGE_SIZE, maxPosts - items.size)
          : MAX_PAGE_SIZE;
      const after =
        migrationCutoff === undefined
          ? ''
          : `&after=${encodeURIComponent(
              // eslint-disable-next-line unicorn/prefer-temporal -- Temporal is unavailable in the supported Node runtime
              new Date(migrationCutoff * 1_000).toISOString(),
            )}`;
      const url = `${API_BASE_URL}/${this.collection}?per_page=${pageSize}&offset=${offset}&_embed=1${after}`;
      const page = await this.fetchPage(url);
      const pageItems = page.items;
      collectionTotal = validatePaginationPage(
        page,
        collectionTotal,
        pageFingerprints,
      );
      offset += pageItems.length;

      for (const item of pageItems) {
        items.set(this.getId(item), item);
      }

      if (
        pageItems.length < pageSize ||
        (collectionTotal !== undefined && offset >= collectionTotal)
      ) {
        break;
      }
    }

    if (items.size === 0 && migrationCutoff === undefined) {
      throw new Error(ERROR_MESSAGES.postsNotFound);
    }

    return items.values().toArray();
  }

  private async fetchPage(url: string): Promise<WordPressPage> {
    let response: Response;

    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(ERROR_MESSAGES.fetchFailed, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`${ERROR_MESSAGES.badResponseCode}: ${response.status}`);
    }

    const total = response.headers.get('X-WP-Total');

    return {
      items: WordPressItemsSchema.parse(await response.json()),
      total: total === null ? undefined : WordPressTotalSchema.parse(total),
    };
  }

  private getId(item: WordPressItem): string {
    return `wordpress:${this.collection}:${item.id}`;
  }

  private getTitle(item: WordPressItem): string {
    return plainText(item.title.rendered) || '?';
  }
}
