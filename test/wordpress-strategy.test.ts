import { afterEach, describe, expect, it, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({
  getLatestLegacySeenAt: vi.fn<(scraperId: string) => number | undefined>(),
  getSeenPostIds: vi.fn<(scraperId: string) => Set<string>>(),
  getSnapshot: vi.fn<(scraperId: string, key: string) => string | undefined>(),
  markPostsSeen:
    vi.fn<(scraperId: string, postIds: Array<null | string>) => void>(),
  setSnapshot: vi.fn<(scraperId: string, key: string, value: string) => void>(),
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
  // eslint-disable-next-line camelcase -- WordPress REST API fixture field
  date_gmt: '1970-01-01T00:01:50',
  id: 42,
  link: 'https://finki.ukim.mk/jobs-and-internships/current-item/',
  title: { rendered: 'Current &amp; item' },
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
  cacheMocks.getLatestLegacySeenAt.mockReset();
  cacheMocks.getSeenPostIds.mockReset();
  cacheMocks.getSnapshot.mockReset();
  cacheMocks.markPostsSeen.mockReset();
  cacheMocks.setSnapshot.mockReset();
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
        `https://finki.ukim.mk/wp-json/wp/v2/${collection}?per_page=5&offset=0&_embed=1`,
      );
      expect(result.itemsFound).toBe(1);
      expect(result.posts).toHaveLength(1);

      result.commit();

      expect(cacheMocks.markPostsSeen).toHaveBeenCalledWith(collection, [
        `wordpress:${collection}:42`,
      ]);
    },
  );

  it('preserves legacy cache identity while committing the canonical WordPress ID', async () => {
    const legacyId = 'https://finki.ukim.mk/mk/content/current-item';
    cacheMocks.getLatestLegacySeenAt.mockReturnValue(100);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set([legacyId]));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        createApiItem({
          // eslint-disable-next-line camelcase -- WordPress REST API fixture field
          date_gmt: '1970-01-01T00:01:30',
        }),
      ]),
    );
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
      'wordpress:jobs-and-internships:42',
    ]);
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      'jobs',
      'wordpress-rest-cutover',
      '100',
    );
  });

  it('continues normally after canonical WordPress IDs are seeded', async () => {
    const canonicalId = 'wordpress:jobs-and-internships:42';
    cacheMocks.getSeenPostIds.mockReturnValue(
      new Set([canonicalId, 'https://finki.ukim.mk/mk/content/legacy']),
    );
    cacheMocks.getSnapshot.mockReturnValue('100');
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
    expect(result.posts[0]?.id).toBe('wordpress:jobs-and-internships:43');
  });

  it('delivers a window disjoint from canonical cache IDs', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(
      new Set(['wordpress:jobs-and-internships:1']),
    );
    cacheMocks.getSnapshot.mockReturnValue('100');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([createApiItem({ id: 42 }), createApiItem({ id: 43 })]),
    );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'ignored',
      maxPosts: 5,
      scraperId: 'jobs',
    });

    expect(result.posts).toHaveLength(2);
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
      'https://finki.ukim.mk/wp-json/wp/v2/jobs-and-internships?per_page=100&offset=0&_embed=1',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://finki.ukim.mk/wp-json/wp/v2/jobs-and-internships?per_page=1&offset=100&_embed=1',
    );
    expect(result.itemsFound).toBe(101);
    expect(new Set(result.posts.map(({ id }) => id)).size).toBe(101);
  });

  it('does not request another page when maxPosts is exactly one full page', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          Array.from({ length: 100 }, (_, index) =>
            createApiItem({ id: index }),
          ),
        ),
      );
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'ignored',
      maxPosts: 100,
      scraperId: 'jobs',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.itemsFound).toBe(100);
  });

  it('reports non-success WordPress responses', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 }),
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
    ).rejects.toThrow('Bad response code: 503');
  });

  it('reports WordPress network failures', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    await expect(
      strategy.getChanges({
        cookie: undefined,
        link: 'ignored',
        maxPosts: 5,
        scraperId: 'jobs',
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('does not commit an empty WordPress collection', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    await expect(
      strategy.getChanges({
        cookie: undefined,
        link: 'ignored',
        maxPosts: 5,
        scraperId: 'jobs',
      }),
    ).rejects.toThrow('Posts not found');
    expect(cacheMocks.markPostsSeen).not.toHaveBeenCalled();
  });

  it('rejects external WordPress post and media URLs', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');
    const strategy = new JobsStrategy();

    for (const item of [
      createApiItem({ link: 'https://evil.example/phishing' }),
      createApiItem({
        _embedded: {
          'wp:featuredmedia': [
            {
              // eslint-disable-next-line camelcase -- WordPress REST API fixture field
              source_url: 'https://evil.example/image.png',
            },
          ],
        },
      }),
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        Response.json([item]),
      );

      await expect(
        strategy.getChanges({
          cookie: undefined,
          link: 'ignored',
          maxPosts: 5,
          scraperId: 'jobs',
        }),
      ).rejects.toThrow('Expected an HTTPS finki.ukim.mk URL');
    }
  });

  it('neutralizes Discord Markdown breakout payloads', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        createApiItem({
          content: {
            rendered:
              '<p>[FINKI Login](https://evil.example/phish) @everyone</p>',
          },
          link: 'https://finki.ukim.mk/) [Login](https://evil.example/phish',
          title: {
            rendered: 'Trusted](https://evil.example/phish)[label',
          },
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
    const serialized = JSON.stringify(result.posts[0]);

    expect(serialized).not.toContain('](https://evil.example');
    expect(serialized).not.toContain('@everyone');
    expect(serialized).toContain(
      '%29%20%5BLogin%5D%28https://evil.example/phish',
    );
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
