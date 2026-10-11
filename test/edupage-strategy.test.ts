import { afterEach, describe, expect, it, vi } from 'vitest';

import { EduPageStrategy } from '../src/strategies/EduPageStrategy.js';

const cacheMocks = vi.hoisted(() => ({
  getSnapshot: vi.fn<(scraperId: string, key: string) => string | undefined>(),
  setSnapshot: vi.fn<(scraperId: string, key: string, value: string) => void>(),
  setSnapshots: vi.fn<
    (scraperId: string, snapshots: Record<string, string>) => void
  >((scraperId: string, snapshots: Record<string, string>) => {
    for (const [key, value] of Object.entries(snapshots)) {
      cacheMocks.setSnapshot(scraperId, key, value);
    }
  }),
}));

vi.mock('../src/utils/cache.js', () => cacheMocks);

const LISTING_KEY = 'listing';
const SCRAPER_ID = 'edupage-test';
const BASE_URL = 'https://finki.edupage.org';

const makeListingSnapshot = (defaultNum: string, ttNums: string[]): string =>
  JSON.stringify({ defaultNum, ttNums });

const mockSnapshots = (
  listing: string,
  snapshots: Record<string, string> = {},
): void => {
  cacheMocks.getSnapshot.mockImplementation((_scraperId, key) => {
    if (key === LISTING_KEY) return listing;

    return snapshots[key];
  });
};

const oldCard = (cardId: string, subject: string) => ({
  cardId,
  classes: [],
  classrooms: [],
  day: 'Понеделник',
  durationPeriods: '1',
  period: '—',
  subject,
  teachers: [],
  weeks: '',
});

const listingResponse = (defaultNum: string, ttNums: string[]): Response =>
  Response.json({
    r: {
      regular: {
        // eslint-disable-next-line camelcase -- EduPage API field name
        default_num: defaultNum,

        timetables: ttNums.map((ttNum) => ({
          name: `Timetable ${ttNum}`,
          // eslint-disable-next-line camelcase -- EduPage API field name
          tt_num: ttNum,
        })),
      },
    },
  });

const timetableResponse = (
  cards: Array<Record<string, unknown>> = [],
): Response =>
  Response.json({
    r: {
      dbiAccessorRes: {
        tables: [
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: cards,
            id: 'cards',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: [{ id: 'lesson-1', subjectid: 'subject-1' }],
            id: 'lessons',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: [{ id: 'subject-1', name: 'Science' }],
            id: 'subjects',
          },
        ],
      },
    },
  });

const runStrategy = async (
  defaultNum: string,
  ttNums: string[],
  cards: Array<Record<string, unknown>> = [],
): Promise<Awaited<ReturnType<EduPageStrategy['getChanges']>>> => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(listingResponse(defaultNum, ttNums));
  if (defaultNum !== '') {
    fetchMock.mockResolvedValueOnce(timetableResponse(cards));
  }
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Temporal', {
    Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
  });

  return new EduPageStrategy().getChanges({
    cookie: undefined,
    link: BASE_URL,
    maxPosts: 20,
    scraperId: SCRAPER_ID,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cacheMocks.getSnapshot.mockReset();
  cacheMocks.setSnapshot.mockReset();
  cacheMocks.setSnapshots.mockClear();
});

describe('EduPageStrategy', () => {
  it('keeps the first listing as a silent baseline', async () => {
    cacheMocks.getSnapshot.mockReturnValue(undefined);

    const result = await runStrategy('29', ['29']);

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      'listing',
      JSON.stringify({ defaultNum: '29', ttNums: ['29'] }),
    );
  });

  it('treats malformed persisted listing JSON as a missing baseline', async () => {
    mockSnapshots('{broken');

    const result = await runStrategy('29', ['29']);

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshots).toHaveBeenCalledExactlyOnceWith(
      SCRAPER_ID,
      {
        'cards:29': '[]',
        listing: makeListingSnapshot('29', ['29']),
      },
    );
  });

  it('treats malformed persisted cards JSON as a missing card baseline', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), { 'cards:28': '{broken' });

    const result = await runStrategy(
      '28',
      ['28'],
      [
        {
          days: '1000000',
          durationperiods: '1',
          id: 'card-1',
          lessonid: 'lesson-1',
        },
      ],
    );

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshots).not.toHaveBeenCalled();
  });

  it('rejects a non-2xx listing response even when its JSON matches the schema', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          r: {
            regular: {
              // eslint-disable-next-line camelcase -- EduPage API field name
              default_num: '29',
              // eslint-disable-next-line camelcase -- EduPage API field name
              timetables: [{ tt_num: '29' }],
            },
          },
        },
        { headers: { 'Content-Type': 'application/json' }, status: 503 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new EduPageStrategy().getChanges({
        cookie: undefined,
        link: BASE_URL,
        maxPosts: 20,
        scraperId: SCRAPER_ID,
      }),
    ).rejects.toThrow('EduPage listing request failed with status 503');
    expect(cacheMocks.setSnapshots).not.toHaveBeenCalled();
  });

  it('rejects a non-2xx timetable response before any snapshot commit', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listingResponse('29', ['29']))
      .mockResolvedValueOnce(
        Response.json(
          { r: { dbiAccessorRes: { tables: [] } } },
          { headers: { 'Content-Type': 'application/json' }, status: 500 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new EduPageStrategy().getChanges({
        cookie: undefined,
        link: BASE_URL,
        maxPosts: 20,
        scraperId: SCRAPER_ID,
      }),
    ).rejects.toThrow('EduPage timetable request failed with status 500');
    expect(cacheMocks.setSnapshots).not.toHaveBeenCalled();
  });

  it('notifies a new active timetable even when its card baseline is missing', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']));

    const result = await runStrategy('29', ['28', '29']);

    expect(result.posts.map(({ id }) => id)).toContain('new-tt:29');
    expect(result.posts.map(({ id }) => id)).toContain('default-tt:29');
    expect(cacheMocks.setSnapshots).not.toHaveBeenCalled();
    expect(cacheMocks.setSnapshot).not.toHaveBeenCalled();

    result.commit();

    expect(cacheMocks.setSnapshots).toHaveBeenCalledExactlyOnceWith(
      SCRAPER_ID,
      { 'cards:29': '[]', listing: makeListingSnapshot('29', ['28', '29']) },
    );
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      'cards:29',
      '[]',
    );
  });

  it('notifies a newly listed timetable without a card snapshot', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), { 'cards:28': '[]' });

    const result = await runStrategy('28', ['28', '29']);

    expect(result.posts.map(({ id }) => id)).toStrictEqual(['new-tt:29']);
  });

  it('does not notify removed timetables alongside a new active timetable', async () => {
    mockSnapshots(makeListingSnapshot('28', ['27', '28']), {
      'cards:28': '[]',
    });

    const result = await runStrategy('29', ['29']);

    expect(result.posts.map(({ id }) => id)).toStrictEqual([
      'new-tt:29',
      'default-tt:29',
    ]);
  });

  it('notifies activation of an existing timetable without cards and retries before commit', async () => {
    mockSnapshots(makeListingSnapshot('27', ['27', '28']));

    const firstResult = await runStrategy('28', ['27', '28']);
    const retryResult = await runStrategy('28', ['27', '28']);

    expect(firstResult.posts.map(({ id }) => id)).toStrictEqual([
      'default-tt:28',
    ]);
    expect(retryResult.posts.map(({ id }) => id)).toStrictEqual([
      'default-tt:28',
    ]);
    expect(cacheMocks.setSnapshot).not.toHaveBeenCalled();
  });

  it('silently persists removal of active and inactive timetables', async () => {
    mockSnapshots(makeListingSnapshot('28', ['27', '28']));

    const result = await runStrategy('', []);

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshot).not.toHaveBeenCalled();

    result.commit();

    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      LISTING_KEY,
      makeListingSnapshot('', []),
    );
  });

  it('keeps deactivation silent when the active timetable remains listed', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), { 'cards:': '[]' });

    const result = await runStrategy('', ['28']);

    expect(result.posts).toStrictEqual([]);
  });

  it('does not repeat a listing change after the returned commit', async () => {
    let listingSnapshot: string | undefined = JSON.stringify({
      defaultNum: '28',
      ttNums: ['28'],
    });
    cacheMocks.getSnapshot.mockImplementation((_scraperId, key) => {
      if (key === LISTING_KEY) return listingSnapshot;

      return key === 'cards:29' ? '[]' : undefined;
    });
    cacheMocks.setSnapshot.mockImplementation((_scraperId, key, value) => {
      if (key === 'listing') listingSnapshot = value;
    });

    const firstResult = await runStrategy('29', ['28', '29']);

    expect(firstResult.posts.map(({ id }) => id)).toContain('new-tt:29');

    firstResult.commit();
    cacheMocks.setSnapshot.mockClear();

    const secondResult = await runStrategy('29', ['28', '29']);

    expect(secondResult.posts).toStrictEqual([]);
  });

  it('keeps unchanged listing and cards silent', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), { 'cards:28': '[]' });

    const result = await runStrategy('28', ['28']);

    expect(result.posts).toStrictEqual([]);
  });

  it('still reports edits and removals in the active timetable cards', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([
        oldCard('card-1', 'Math'),
        oldCard('card-2', 'History'),
      ]),
    });

    const result = await runStrategy(
      '28',
      ['28'],
      [
        {
          days: '1000000',
          durationperiods: '1',
          id: 'card-1',
          lessonid: 'lesson-1',
        },
      ],
    );

    expect(result.posts.map(({ id }) => id)).toHaveLength(2);

    const postIds = result.posts.map(({ id }) => id);

    expect(
      postIds.filter((id) => id?.startsWith('change:28:card-1:')),
    ).toHaveLength(1);
    expect(
      postIds.filter((id) => id?.startsWith('change:28:card-2:')),
    ).toHaveLength(1);
  });

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
      link: BASE_URL,
      maxPosts: 20,
      scraperId: SCRAPER_ID,
    });

    expect(result.posts).toStrictEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      'cards:',
      '[]',
    );
  });

  it('silently persists deactivation when the timetable remains listed', async () => {
    cacheMocks.getSnapshot.mockImplementation((_scraperId, key) => {
      if (key === 'listing') {
        return JSON.stringify({ defaultNum: '28', ttNums: ['28'] });
      }

      return key === 'cards:' ? '[]' : undefined;
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Temporal', {
      Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
    });
    const strategy = new EduPageStrategy();

    const result = await strategy.getChanges({
      cookie: undefined,
      link: BASE_URL,
      maxPosts: 20,
      scraperId: SCRAPER_ID,
    });

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.setSnapshot).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();

    result.commit();

    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      LISTING_KEY,
      JSON.stringify({ defaultNum: '', ttNums: ['28'] }),
    );
    expect(cacheMocks.setSnapshot).toHaveBeenCalledWith(
      SCRAPER_ID,
      'cards:',
      '[]',
    );
  });
});
