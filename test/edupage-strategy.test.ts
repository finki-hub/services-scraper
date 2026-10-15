import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
type CardOptions = {
  classes?: string[];
  classrooms?: string[];
  teachers?: string[];
  weeks?: string;
};
type LookupRows = Partial<
  Record<
    'classes' | 'classrooms' | 'lessons' | 'teachers',
    Array<Record<string, unknown>>
  >
>;
type StrategyOptions = {
  cards?: Array<Record<string, unknown>>;
  lookupRows?: LookupRows;
};

const makeListingSnapshot = (defaultNum: string, ttNums: string[]): string =>
  JSON.stringify({ defaultNum, ttNums });

const mockSnapshots = (
  listing: string,
  snapshots: Record<string, string> = {},
): void => {
  cacheMocks.getSnapshot.mockImplementation((_scraperId, key) =>
    key === LISTING_KEY ? listing : snapshots[key],
  );
};

const oldCard = (
  cardId: string,
  subject: string,
  options: CardOptions = {},
) => ({
  cardId,
  classes: options.classes ?? [],
  classrooms: options.classrooms ?? [],
  day: 'Понеделник',
  durationPeriods: '1',
  period: '—',
  subject,
  teachers: options.teachers ?? [],
  weeks: options.weeks ?? '',
});

const currentCardRow = (cardId: string, weeks = '') => ({
  days: '1000000',
  durationperiods: '1',
  id: cardId,
  lessonid: 'lesson-1',
  period: 'period-1',
  weeks,
});

const expectSingleUpdatePost = (
  result: Awaited<ReturnType<EduPageStrategy['getChanges']>>,
): void => {
  expect(result.posts).toHaveLength(1);

  const componentJson = result.posts[0]?.component.toJSON();

  expect(JSON.stringify(componentJson)).toContain('Промени во распоредот');
  expect(JSON.stringify(componentJson)).toContain(BASE_URL);
};

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
  lookupRows: LookupRows = {},
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
            data_rows: lookupRows.lessons ?? [
              { id: 'lesson-1', subjectid: 'subject-1' },
            ],
            id: 'lessons',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: [{ id: 'subject-1', name: 'Science' }],
            id: 'subjects',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: [{ id: 'period-1', name: '—' }],
            id: 'periods',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: lookupRows.classes ?? [],
            id: 'classes',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: lookupRows.classrooms ?? [],
            id: 'classrooms',
          },
          {
            // eslint-disable-next-line camelcase -- EduPage API field name
            data_rows: lookupRows.teachers ?? [],
            id: 'teachers',
          },
        ],
      },
    },
  });

const runStrategy = async (
  defaultNum: string,
  ttNums: string[],
  options: StrategyOptions = {},
): Promise<Awaited<ReturnType<EduPageStrategy['getChanges']>>> => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(listingResponse(defaultNum, ttNums));
  if (defaultNum !== '') {
    fetchMock.mockResolvedValueOnce(
      timetableResponse(options.cards, options.lookupRows),
    );
  }
  vi.stubGlobal('fetch', fetchMock);

  return new EduPageStrategy().getChanges({
    cookie: undefined,
    link: BASE_URL,
    maxPosts: 20,
    scraperId: SCRAPER_ID,
  });
};

beforeEach(() => {
  vi.stubGlobal('Temporal', {
    Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cacheMocks.getSnapshot.mockReset();
  cacheMocks.setSnapshot.mockReset();
  cacheMocks.setSnapshots.mockClear();
});

describe('EduPageStrategy baselines and request errors', () => {
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

    const result = await runStrategy('28', ['28'], {
      cards: [
        {
          days: '1000000',
          durationperiods: '1',
          id: 'card-1',
          lessonid: 'lesson-1',
        },
      ],
    });

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
});

describe('EduPageStrategy timetable changes', () => {
  it('notifies a new active timetable even when its card baseline is missing', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']));

    const result = await runStrategy('29', ['28', '29']);

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);

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

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);
  });

  it('does not notify removed timetables alongside a new active timetable', async () => {
    mockSnapshots(makeListingSnapshot('28', ['27', '28']), {
      'cards:28': '[]',
    });

    const result = await runStrategy('29', ['29']);

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);
  });

  it('notifies activation of an existing timetable without cards and retries before commit', async () => {
    mockSnapshots(makeListingSnapshot('27', ['27', '28']));

    const firstResult = await runStrategy('28', ['27', '28']);
    const retryResult = await runStrategy('28', ['27', '28']);

    expect(firstResult.posts).toHaveLength(1);
    expect(retryResult.posts).toHaveLength(1);

    expectSingleUpdatePost(firstResult);
    expectSingleUpdatePost(retryResult);

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

    expect(firstResult.posts).toHaveLength(1);

    expectSingleUpdatePost(firstResult);

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
});

describe('EduPageStrategy semantic card changes', () => {
  it('reports semantic additions/edits once and keeps card removals silent', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([
        oldCard('card-1', 'Math'),
        oldCard('card-2', 'History'),
      ]),
    });

    const result = await runStrategy('28', ['28'], {
      cards: [
        {
          days: '1000000',
          durationperiods: '1',
          id: 'card-1',
          lessonid: 'lesson-1',
        },
      ],
    });

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);

    expect(JSON.stringify(result.posts[0]?.component.toJSON())).not.toContain(
      'Math',
    );
  });

  it('silences ID renumbering, card reordering, and duplicate-preserving semantic matches', async () => {
    const previousCards = [
      oldCard('old-a', 'Science', { weeks: 'week-a' }),
      oldCard('old-b', 'Science', { weeks: 'week-a' }),
      oldCard('old-c', 'Science', { weeks: 'week-b' }),
    ];
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify(previousCards),
    });

    const result = await runStrategy('28', ['28'], {
      cards: [
        currentCardRow('new-c', 'week-b'),
        currentCardRow('new-b', 'week-a'),
        currentCardRow('new-a', 'week-a'),
      ],
    });

    expect(result.posts).toStrictEqual([]);

    result.commit();

    expect(cacheMocks.setSnapshots).toHaveBeenCalledExactlyOnceWith(
      SCRAPER_ID,
      {
        'cards:28': JSON.stringify([
          oldCard('new-a', 'Science', { weeks: 'week-a' }),
          oldCard('new-b', 'Science', { weeks: 'week-a' }),
          oldCard('new-c', 'Science', { weeks: 'week-b' }),
        ]),
        listing: makeListingSnapshot('28', ['28']),
      },
    );
  });
});

describe('EduPageStrategy semantic list and aggregate changes', () => {
  it('compares list values deterministically across order and Unicode normalization', async () => {
    const composed = 'é';
    const decomposed = 'e\u{301}';
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([
        oldCard('old-card', 'Science', {
          classes: [composed, decomposed],
          classrooms: ['Room A', 'Room B'],
          teachers: ['Ada', 'Grace'],
        }),
      ]),
    });

    const result = await runStrategy('28', ['28'], {
      cards: [currentCardRow('new-card')],
      lookupRows: {
        classes: [
          { id: 'class-composed', name: composed },
          { id: 'class-decomposed', name: decomposed },
        ],
        classrooms: [
          { id: 'room-a', name: 'Room A' },
          { id: 'room-b', name: 'Room B' },
        ],
        lessons: [
          {
            classids: ['class-decomposed', 'class-composed'],
            classroomids: ['room-b', 'room-a'],
            id: 'lesson-1',
            subjectid: 'subject-1',
            teacherids: ['teacher-grace', 'teacher-ada'],
          },
        ],
        teachers: [
          { id: 'teacher-ada', name: 'Ada' },
          { id: 'teacher-grace', name: 'Grace' },
        ],
      },
    });

    expect(result.posts).toStrictEqual([]);
    expect(cacheMocks.getSnapshot).toHaveBeenCalledWith(SCRAPER_ID, 'cards:28');

    result.commit();

    expect(cacheMocks.setSnapshots).toHaveBeenCalledExactlyOnceWith(
      SCRAPER_ID,
      {
        'cards:28': JSON.stringify([
          oldCard('new-card', 'Science', {
            classes: [decomposed, composed],
            classrooms: ['Room B', 'Room A'],
            teachers: ['Grace', 'Ada'],
          }),
        ]),
        listing: makeListingSnapshot('28', ['28']),
      },
    );
  });

  it('notifies once for a genuine current card addition while silently dropping removed cards', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([
        oldCard('old-a', 'Science', { weeks: 'week-a' }),
        oldCard('old-b', 'Science', { weeks: 'week-b' }),
      ]),
    });

    const result = await runStrategy('28', ['28'], {
      cards: [
        currentCardRow('new-a', 'week-a'),
        currentCardRow('new-c', 'week-c'),
      ],
    });

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);
  });

  it('commits a pure card removal silently', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([
        oldCard('old-a', 'Science', { weeks: 'week-a' }),
        oldCard('old-b', 'Science', { weeks: 'week-b' }),
      ]),
    });

    const result = await runStrategy('28', ['28'], {
      cards: [currentCardRow('new-a', 'week-a')],
    });

    expect(result.posts).toStrictEqual([]);

    result.commit();

    expect(cacheMocks.setSnapshots).toHaveBeenCalledExactlyOnceWith(
      SCRAPER_ID,
      {
        'cards:28': JSON.stringify([
          oldCard('new-a', 'Science', { weeks: 'week-a' }),
        ]),
        listing: makeListingSnapshot('28', ['28']),
      },
    );
  });

  it('combines timetable listing and card changes into a single update', async () => {
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify([oldCard('card-1', 'Old subject')]),
    });

    const result = await runStrategy('28', ['28', '29'], {
      cards: [currentCardRow('card-1', 'changed-week')],
    });

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);
  });

  it('emits one bounded summary for a 225-to-224 ID-churn listing', async () => {
    const previousCards = Array.from({ length: 225 }, (_, index) =>
      oldCard(`card-${index}`, 'Science', {
        weeks: index < 216 ? `common-${index}` : `removed-${index}`,
      }),
    );
    const currentCards = Array.from({ length: 224 }, (_, index) => {
      let weeks: string;
      if (index < 143) weeks = `common-${index + 1}`;
      else if (index === 143) weeks = 'common-0';
      else if (index < 216) weeks = `common-${index}`;
      else weeks = `added-${index}`;

      return currentCardRow(`card-${index}`, weeks);
    });
    mockSnapshots(makeListingSnapshot('28', ['28']), {
      'cards:28': JSON.stringify(previousCards),
    });

    const result = await runStrategy('28', ['28'], { cards: currentCards });

    expect(result.posts).toHaveLength(1);

    expectSingleUpdatePost(result);

    expect(JSON.stringify(result.posts[0]?.component.toJSON())).not.toContain(
      'common-',
    );
    expect(JSON.stringify(result.posts[0]?.component.toJSON())).not.toContain(
      'removed-',
    );
  });
});

describe('EduPageStrategy inactive timetable behavior', () => {
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
