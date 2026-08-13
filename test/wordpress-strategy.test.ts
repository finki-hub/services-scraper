import { afterEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  getSeenPostIds: vi.fn<(scraperId: string) => Set<string>>(),
  markPostsSeen:
    vi.fn<(scraperId: string, postIds: Array<null | string>) => void>(),
}));

vi.mock('../src/utils/cache.js', () => cacheMocks);
vi.mock('../src/configuration/config.js', () => ({
  getConfigProperty: vi.fn<() => undefined>(),
}));

const createApiItem = (overrides: Record<string, unknown> = {}) => ({
  _embedded: {
    'wp:featuredmedia': [
      {
        // eslint-disable-next-line camelcase -- WordPress REST API fixture field
        source_url: 'https://finki.ukim.mk/wp-content/uploads/item.jpg',
      },
    ],
  },
  content: { rendered: '<p>Current <strong>description</strong>.</p>' },
  id: 42,
  link: 'https://finki.ukim.mk/jobs-and-internships/current-item/',
  title: { rendered: 'Current &amp; item' },
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  cacheMocks.getSeenPostIds.mockReset();
  cacheMocks.markPostsSeen.mockReset();
});

describe('WordPress strategies', () => {
  it.each([
    ['announcements', 'announcement'],
    ['jobs', 'jobs-and-internships'],
    ['events', 'event'],
    ['projects', 'project'],
    ['timetables', 'schedule'],
  ])(
    'fetches the %s collection instead of the configured legacy page',
    async (strategyName, collection) => {
      cacheMocks.getSeenPostIds.mockReturnValue(new Set());
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json([createApiItem()]));
      const { createStrategy } = await import('../src/utils/strategies.js');
      const strategy = createStrategy(strategyName) as {
        getChanges: (context: {
          cookie: undefined;
          link: string;
          maxPosts: number;
          scraperId: string;
        }) => Promise<{
          commit: () => void;
          itemsFound?: number;
          posts: unknown[];
        }>;
      };

      const result = await strategy.getChanges({
        cookie: undefined,
        link: 'https://oldsite.invalid/legacy-listing',
        maxPosts: 5,
        scraperId: collection,
      });

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `https://finki.ukim.mk/wp-json/wp/v2/${collection}?per_page=5&page=1&_embed=1`,
      );
      expect(result.itemsFound).toBe(1);
      expect(result.posts).toHaveLength(1);

      result.commit();

      expect(cacheMocks.markPostsSeen).toHaveBeenCalledWith(collection, [
        'https://finki.ukim.mk/jobs-and-internships/current-item/',
      ]);
    },
  );

  it('preserves legacy cache identity while committing the canonical WordPress ID', async () => {
    const legacyId = 'https://finki.ukim.mk/mk/content/current-item';
    cacheMocks.getSeenPostIds.mockReturnValue(new Set([legacyId]));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([createApiItem()]));
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'https://oldsite.invalid/legacy-listing',
      maxPosts: 5,
      scraperId: 'jobs',
    });

    expect(result.posts).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();

    result.commit();

    expect(cacheMocks.markPostsSeen).toHaveBeenCalledWith('jobs', [
      'https://finki.ukim.mk/jobs-and-internships/current-item/',
    ]);
  });

  it('continues normally after canonical WordPress IDs are seeded', async () => {
    const canonicalId =
      'https://finki.ukim.mk/jobs-and-internships/current-item/';
    cacheMocks.getSeenPostIds.mockReturnValue(
      new Set([canonicalId, 'https://finki.ukim.mk/mk/content/legacy']),
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        createApiItem(),
        createApiItem({
          id: 43,
          link: 'https://finki.ukim.mk/jobs-and-internships/new-item/',
          title: { rendered: 'New item' },
        }),
      ]),
    );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'ignored',
      maxPosts: 5,
      scraperId: 'jobs',
    });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]?.id).toBe(
      'https://finki.ukim.mk/jobs-and-internships/new-item/',
    );
  });

  it('paginates WordPress requests above the collection page limit', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      createApiItem({
        id: index,
        link: `https://finki.ukim.mk/jobs-and-internships/item-${index}/`,
      }),
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(
        Response.json([
          createApiItem({
            id: 101,
            link: 'https://finki.ukim.mk/jobs-and-internships/item-101/',
          }),
        ]),
      );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'ignored',
      maxPosts: 101,
      scraperId: 'jobs',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://finki.ukim.mk/wp-json/wp/v2/jobs-and-internships?per_page=100&page=1&_embed=1',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://finki.ukim.mk/wp-json/wp/v2/jobs-and-internships?per_page=1&page=2&_embed=1',
    );
    expect(result.itemsFound).toBe(101);
  });

  it('renders WordPress HTML as plain Discord text with featured media', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([createApiItem()]),
    );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'ignored',
      maxPosts: 5,
      scraperId: 'jobs',
    });
    const serialized = JSON.stringify(result.posts[0]);

    expect(serialized).toContain('Current & item');
    expect(serialized).toContain('Current description.');
    expect(serialized).toContain(
      'https://finki.ukim.mk/wp-content/uploads/item.jpg',
    );
  });

  it('rejects malformed WordPress responses instead of treating them as no changes', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([{ id: 42 }]),
    );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    await expect(
      strategy.getChanges({
        cookie: undefined,
        link: 'ignored',
        maxPosts: 5,
        scraperId: 'jobs',
      }),
    ).rejects.toThrow('Invalid input');
  });
});
