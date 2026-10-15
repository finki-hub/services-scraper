import type { Cheerio } from 'cheerio';

import { TextDisplayBuilder } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CheerioElement } from '../src/lib/Html.js';
import type { PostData } from '../src/lib/Post.js';

const configModulePath = '../src/configuration/config.js';
const cacheModulePath = '../src/utils/cache.js';
const loggerModulePath = '../src/utils/logger.js';

const cacheMocks = {
  getSeenPostIds: vi.fn<(scraperId: string) => Set<string>>(),
  markPostsSeen:
    vi.fn<(scraperId: string, postIds: Array<null | string>) => void>(),
};

const setupHtmlStrategy = async (postsSelector: string) => {
  vi.doMock(configModulePath, () => ({
    getConfigProperty: vi.fn<(...args: unknown[]) => unknown>(),
  }));
  vi.doMock(cacheModulePath, () => cacheMocks);
  vi.doMock(loggerModulePath, () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));

  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('unused response', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  const { HtmlStrategy } =
    await import('../src/strategies/base/HtmlStrategy.js');

  class TestHtmlStrategy extends HtmlStrategy {
    public postsSelector = postsSelector;

    public getId($element: Cheerio<CheerioElement>): null | string {
      return $element.attr('data-id') ?? null;
    }

    public getPostData($element: Cheerio<CheerioElement>): PostData {
      const id = this.getId($element);

      return {
        component: new TextDisplayBuilder().setContent(id ?? 'missing-id'),
        id,
      };
    }
  }

  return { fetchMock, strategy: new TestHtmlStrategy() };
};

const context = {
  cookie: undefined,
  link: 'https://example.test/',
  scraperId: 'test',
};

afterEach(() => {
  vi.doUnmock(configModulePath);
  vi.doUnmock(cacheModulePath);
  vi.doUnmock(loggerModulePath);
  vi.unstubAllGlobals();
  cacheMocks.getSeenPostIds.mockReset();
  cacheMocks.markPostsSeen.mockReset();
  vi.resetModules();
});

describe('HtmlStrategy DOM selection regressions', () => {
  it('keeps tag, script, and style fragment nodes while filtering text and comments before the cap', async () => {
    const fragment = [
      '<script data-id="already-seen">script content</script>',
      '<!-- comment node -->',
      'loose text node',
      '<style data-id="new-1">style content</style>',
      '<article data-id="already-seen">duplicate seen ID</article>',
      '<article data-id="new-2">new post</article>',
      '<article data-id="outside-cap">outside cap</article>',
    ].join('');
    const { fetchMock, strategy } = await setupHtmlStrategy(fragment);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['already-seen']));

    const result = await strategy.getChanges({ ...context, maxPosts: 4 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheMocks.getSeenPostIds).toHaveBeenCalledExactlyOnceWith('test');
    expect(result.itemsFound).toBe(4);
    expect(result.posts.map(({ id }) => id)).toStrictEqual(['new-2', 'new-1']);
    expect(cacheMocks.markPostsSeen).not.toHaveBeenCalled();

    result.commit();

    expect(cacheMocks.markPostsSeen).toHaveBeenCalledExactlyOnceWith('test', [
      'already-seen',
      'new-1',
      'already-seen',
      'new-2',
    ]);
  });

  it('throws when an HTML fragment selector contains only comment and text nodes', async () => {
    const { fetchMock, strategy } = await setupHtmlStrategy(
      '<!-- no post elements -->just text',
    );

    await expect(
      strategy.getChanges({ ...context, maxPosts: 5 }),
    ).rejects.toThrow('Posts not found');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheMocks.getSeenPostIds).not.toHaveBeenCalled();
    expect(cacheMocks.markPostsSeen).not.toHaveBeenCalled();
  });
});
