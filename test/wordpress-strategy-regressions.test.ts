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

const createApiItem = (
  id: number,
  slug: string,
  dateGmt = '1970-01-01T00:01:50',
) => ({
  content: { rendered: `<p>Item ${id}</p>` },
  // eslint-disable-next-line camelcase -- WordPress REST API fixture field
  date_gmt: dateGmt,
  id,
  link: `https://finki.ukim.mk/jobs-and-internships/${slug}/`,
  title: { rendered: `Item ${id}` },
});

const getJobChanges = async (maxPosts: number) => {
  const { JobsStrategy } = await import('../src/strategies/JobsStrategy.js');

  return new JobsStrategy().getChanges({
    cookie: undefined,
    link: 'ignored',
    maxPosts,
    scraperId: 'jobs',
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  cacheMocks.getLatestLegacySeenAt.mockReset();
  cacheMocks.getSeenPostIds.mockReset();
  cacheMocks.getSnapshot.mockReset();
  cacheMocks.markPostsSeen.mockReset();
  cacheMocks.setSnapshot.mockReset();
});

describe('WordPress strategy regressions', () => {
  it('delivers only posts published after the last legacy scrape', async () => {
    cacheMocks.getLatestLegacySeenAt.mockReturnValue(100);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['legacy-id']));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        createApiItem(44, 'newest', '1970-01-01T00:02:00'),
        createApiItem(43, 'newer', '1970-01-01T00:01:50'),
        createApiItem(42, 'at-cutoff', '1970-01-01T00:01:40'),
        createApiItem(41, 'older', '1970-01-01T00:01:30'),
      ]),
    );

    const result = await getJobChanges(20);

    expect(result.posts.map(({ id }) => id)).toStrictEqual([
      'wordpress:jobs-and-internships:43',
      'wordpress:jobs-and-internships:44',
    ]);
  });

  it('accepts a timezone-qualified WordPress publication date', async () => {
    cacheMocks.getLatestLegacySeenAt.mockReturnValue(100);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['legacy-id']));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([createApiItem(43, 'newer', '1970-01-01T00:01:50Z')]),
    );

    const result = await getJobChanges(20);

    expect(result.posts.map(({ id }) => id)).toStrictEqual([
      'wordpress:jobs-and-internships:43',
    ]);
  });

  it('does not replay a legacy post that enters the current window later', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['unrelated-id']));
    cacheMocks.getSnapshot.mockReturnValue('100');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json([
        createApiItem(42, 'unseeded-legacy-item', '1970-01-01T00:01:30'),
      ]),
    );

    const result = await getJobChanges(20);

    expect(result.posts).toStrictEqual([]);
  });

  it('fetches every cutover post even when there are more than maxPosts', async () => {
    cacheMocks.getLatestLegacySeenAt.mockReturnValue(100);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['legacy-id']));
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      createApiItem(200 - index, `new-${200 - index}`),
    );
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(
        Response.json([
          createApiItem(100, 'last-new', '1970-01-01T00:01:41'),
          createApiItem(99, 'first-old', '1970-01-01T00:01:40'),
        ]),
      );

    const result = await getJobChanges(2);

    expect(result.posts).toHaveLength(101);
  });

  it('completes migration when no posts were published after the cutoff', async () => {
    cacheMocks.getLatestLegacySeenAt.mockReturnValue(100);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(['legacy-id']));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));

    const result = await getJobChanges(20);
    result.commit();

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      'jobs',
      'wordpress-rest-cutover',
      '100',
    );
  });

  it('continues pagination until it collects unique posts', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      createApiItem(200 - index, `item-${200 - index}`),
    );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(firstPage))
      .mockResolvedValueOnce(Response.json([createApiItem(101, 'item-101')]))
      .mockResolvedValueOnce(Response.json([createApiItem(100, 'item-100')]));

    const result = await getJobChanges(101);
    const ids = result.posts.map(({ id }) => id);

    expect(ids).toHaveLength(101);
    expect(new Set(ids)).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a collection that changes during offset pagination', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      createApiItem(200 - index, `item-${200 - index}`),
    );
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(firstPage, { headers: { 'X-WP-Total': '101' } }),
      )
      .mockResolvedValueOnce(
        Response.json([createApiItem(100, 'item-100')], {
          headers: { 'X-WP-Total': '100' },
        }),
      );

    await expect(getJobChanges(101)).rejects.toThrow(
      'WordPress collection changed during pagination',
    );
  });

  it('rejects a repeated full page instead of paginating forever', async () => {
    cacheMocks.getSeenPostIds.mockReturnValue(new Set());
    const page = Array.from({ length: 100 }, (_, index) =>
      createApiItem(200 - index, `item-${200 - index}`),
    );
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(page))
      .mockResolvedValueOnce(Response.json(page))
      .mockRejectedValue(new Error('too many requests'));

    await expect(getJobChanges(101)).rejects.toThrow(
      'WordPress repeated a pagination page',
    );
  });
});
