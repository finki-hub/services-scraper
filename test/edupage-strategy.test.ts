import { afterEach, describe, expect, it, vi } from 'vitest';

import { EduPageStrategy } from '../src/strategies/EduPageStrategy.js';

const cacheMocks = vi.hoisted(() => ({
  getSnapshot: vi.fn<(scraperId: string, key: string) => string | undefined>(),
  setSnapshot: vi.fn<(scraperId: string, key: string, value: string) => void>(),
}));

vi.mock('../src/utils/cache.js', () => cacheMocks);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cacheMocks.getSnapshot.mockReset();
  cacheMocks.setSnapshot.mockReset();
});

describe('EduPageStrategy', () => {
  it('skips card data fetching when EduPage has no active timetable', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          r: {
            regular: {
              // eslint-disable-next-line camelcase -- EduPage API field name
              default_num: '',
              // eslint-disable-next-line camelcase -- EduPage API field name
              timetables: [{ datefrom: '2026-02-23', tt_num: '28' }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ r: { error: 'Timetable does not exists' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Temporal', {
      Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
    });
    const strategy = new EduPageStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'https://finki.edupage.org',
      maxPosts: 20,
      scraperId: 'edupage-test',
    });

    expect(result.posts).toStrictEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      'edupage-test',
      'cards:',
      '[]',
    );
  });

  it('persists an inactive timetable transition when no posts are created', async () => {
    cacheMocks.getSnapshot.mockImplementation((_scraperId, key) => {
      if (key === 'listing') {
        return JSON.stringify({ defaultNum: '28', ttNums: ['28'] });
      }

      return key === 'cards:' ? '[]' : undefined;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          r: {
            regular: {
              // eslint-disable-next-line camelcase -- EduPage API field name
              default_num: '',
              // eslint-disable-next-line camelcase -- EduPage API field name
              timetables: [{ datefrom: '2026-02-23', tt_num: '28' }],
            },
          },
        }),
      ),
    );
    vi.stubGlobal('Temporal', {
      Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
    });
    const strategy = new EduPageStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'https://finki.edupage.org',
      maxPosts: 20,
      scraperId: 'edupage-test',
    });

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      'edupage-test',
      'listing',
      JSON.stringify({ defaultNum: '', ttNums: ['28'] }),
    );
  });
});
