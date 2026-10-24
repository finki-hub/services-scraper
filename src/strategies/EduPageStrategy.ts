import { z } from 'zod';

import type { PostData } from '../lib/Post.js';
import type {
  ScraperStrategy,
  StrategyContext,
  StrategyResult,
} from '../lib/Scraper.js';

import { getSnapshot, setSnapshots } from '../utils/cache.js';
import {
  type ActivatedTimetable,
  createTimetableUpdateComponent,
  diffCards,
  hasCardDiff,
  type ResolvedCard,
  ResolvedCardSchema,
  type TimetableInfo,
} from '../utils/edupage.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const SPLIT_REGEX = /[,;]/u;
const CARD_ID_COLLATOR = new Intl.Collator();
const DAY_NAMES = [
  'Понеделник',
  'Вторник',
  'Среда',
  'Четврток',
  'Петок',
  'Сабота',
  'Недела',
];

const ListingTimetableSchema = z.looseObject({
  datefrom: z.unknown().optional(),
  dateto: z.unknown().optional(),
  name: z.unknown().optional(),
  // eslint-disable-next-line camelcase -- EduPage API field name
  tt_num: z.union([z.number(), z.string()]).transform(String),
});

const ListingResponseSchema = z.object({
  r: z.object({
    regular: z.object({
      // eslint-disable-next-line camelcase -- EduPage API field name
      default_num: z.union([z.number(), z.string()]).transform(String),
      timetables: z.array(ListingTimetableSchema),
    }),
  }),
});

const RawRowSchema = z.record(z.string(), z.unknown());

const DbiTableSchema = z.looseObject({
  // eslint-disable-next-line camelcase -- EduPage API field name
  data_rows: z.array(RawRowSchema),
  id: z.string(),
});

const TimetableResponseSchema = z.object({
  r: z.object({
    dbiAccessorRes: z.object({
      tables: z.array(DbiTableSchema),
    }),
  }),
});

const ListingSnapshotSchema = z.object({
  defaultNum: z.string(),
  ttNums: z.array(z.string()),
});

const ResolvedCardsSnapshotSchema = z.array(ResolvedCardSchema);

type ListingResponse = z.infer<typeof ListingResponseSchema>;
type ListingTimetable = z.infer<typeof ListingTimetableSchema>;
type RawRow = z.infer<typeof RawRowSchema>;
type TimetableResponse = z.infer<typeof TimetableResponseSchema>;

const getCurrentSchoolYear = (): number => {
  const now = Temporal.Now.plainDateISO();

  return now.month <= 7 ? now.year - 1 : now.year;
};

const getStringValue = (row: RawRow | undefined, keys: string[]): string => {
  if (row === undefined) {
    return '';
  }

  for (const key of keys) {
    const value = row[key];

    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }

    if (typeof value === 'number') {
      return String(value);
    }
  }

  return '';
};

const getStringList = (row: RawRow | undefined, keys: string[]): string[] => {
  if (row === undefined) {
    return [];
  }

  for (const key of keys) {
    const value = row[key];

    if (Array.isArray(value)) {
      return value
        .filter(
          (item): item is number | string =>
            typeof item === 'number' || typeof item === 'string',
        )
        .map(String)
        .filter((item) => item !== '');
    }

    if (typeof value === 'number') {
      return [String(value)];
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return value
        .split(SPLIT_REGEX)
        .map((item) => item.trim())
        .filter((item) => item !== '');
    }
  }

  return [];
};

const getRowId = (row: RawRow): string =>
  getStringValue(row, ['id', 'ID', 'num', 'tt_num']);

const createRowMap = (rows: RawRow[]): Map<string, RawRow> =>
  new Map(
    rows
      .map((row) => [getRowId(row), row] as const)
      .filter(([id]) => id !== ''),
  );

const getDisplayName = (row: RawRow | undefined): string => {
  const composedName = [
    getStringValue(row, ['firstname', 'firstName']),
    getStringValue(row, ['lastname', 'lastName']),
  ]
    .filter((part) => part !== '')
    .join(' ');

  return composedName === ''
    ? getStringValue(row, ['name', 'short', 'abbr', 'caption', 'text']) || '?'
    : composedName;
};

const resolveNames = (ids: string[], rows: Map<string, RawRow>): string[] =>
  ids.map((id) => getDisplayName(rows.get(id))).filter((name) => name !== '?');

const getDayName = (days: string): string => {
  const dayIndex = days.split('').indexOf('1');

  return DAY_NAMES[dayIndex] ?? days;
};

const getPeriodText = (
  period: RawRow | undefined,
  fallback: string,
): string => {
  const name = getStringValue(period, ['name', 'short']);
  const start = getStringValue(period, ['starttime', 'startTime', 'start']);
  const end = getStringValue(period, ['endtime', 'endTime', 'end']);

  if (start !== '' && end !== '') {
    return `${start} - ${end}`;
  }

  return name === '' ? fallback : name;
};

const toTimetableInfo = (timetable: ListingTimetable): TimetableInfo => ({
  dateFrom: getStringValue(timetable, ['datefrom']),
  name: getStringValue(timetable, ['name', 'text']) || timetable.tt_num,
});

const parseListingSnapshot = (
  snapshot: string | undefined,
): undefined | z.infer<typeof ListingSnapshotSchema> => {
  if (snapshot === undefined) {
    return undefined;
  }

  let value: unknown;

  try {
    value = JSON.parse(snapshot);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;

    throw error;
  }

  const parsed = ListingSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
};

const parseCardsSnapshot = (
  snapshot: string | undefined,
): ResolvedCard[] | undefined => {
  if (snapshot === undefined) {
    return undefined;
  }

  let value: unknown;

  try {
    value = JSON.parse(snapshot);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;

    throw error;
  }

  const parsed = ResolvedCardsSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : undefined;
};

export class EduPageStrategy implements ScraperStrategy {
  public async getChanges(context: StrategyContext): Promise<StrategyResult> {
    const { link, scraperId } = context;
    const listing = await this.fetchListing(link);
    const currentListingSnapshot = {
      defaultNum: listing.r.regular.default_num,
      ttNums: listing.r.regular.timetables.map(({ tt_num: ttNum }) => ttNum),
    };
    const previousListingSnapshot = parseListingSnapshot(
      getSnapshot(scraperId, 'listing'),
    );
    const currentCards =
      currentListingSnapshot.defaultNum === ''
        ? []
        : this.resolveCards(
            await this.fetchTimetable(link, currentListingSnapshot.defaultNum),
          );
    // Versioned because v1 snapshots lack lesson durations and would diff
    // every card once; a missing v2 snapshot re-baselines silently instead.
    const cardsKey = `cards:v2:${currentListingSnapshot.defaultNum}`;
    const previousCards = parseCardsSnapshot(getSnapshot(scraperId, cardsKey));

    const commit = () => {
      setSnapshots(scraperId, {
        [cardsKey]: JSON.stringify(currentCards),
        listing: JSON.stringify(currentListingSnapshot),
      });
    };

    if (previousListingSnapshot === undefined) {
      commit();

      return { commit: () => {}, posts: [] };
    }

    const { defaultNum } = currentListingSnapshot;
    const timetables = listing.r.regular.timetables;
    const previousTtNums = new Set(previousListingSnapshot.ttNums);
    const isSameActive = defaultNum === previousListingSnapshot.defaultNum;
    const activeTimetable = timetables.find(
      ({ tt_num: ttNum }) => ttNum === defaultNum,
    );
    let activatedTimetable: ActivatedTimetable | undefined;

    if (defaultNum !== '' && !isSameActive) {
      activatedTimetable = {
        ...(activeTimetable === undefined
          ? { dateFrom: '', name: defaultNum }
          : toTimetableInfo(activeTimetable)),
        isNew: !previousTtNums.has(defaultNum),
      };
    }

    // A newly published timetable that is also active is announced only once.
    const publishedTimetables = timetables
      .filter(
        ({ tt_num: ttNum }) =>
          !previousTtNums.has(ttNum) &&
          (activatedTimetable === undefined || ttNum !== defaultNum),
      )
      .map(toTimetableInfo);
    // Compare lessons only while the same timetable stays active; after a
    // switch, an older snapshot of it could be months out of date.
    const cardDiff =
      previousCards !== undefined && isSameActive
        ? diffCards(previousCards, currentCards)
        : undefined;

    if (
      activatedTimetable === undefined &&
      publishedTimetables.length === 0 &&
      !hasCardDiff(cardDiff)
    ) {
      return { commit, posts: [] };
    }

    const post: PostData = {
      component: createTimetableUpdateComponent({
        activatedTimetable,
        cardDiff,
        link,
        publishedTimetables,
      }),
      id: `edupage-update:${defaultNum}:${Date.now()}`,
    };

    return { commit, posts: [post] };
  }

  private async fetchListing(baseUrl: string): Promise<ListingResponse> {
    const response = await fetchWithTimeout(
      `${baseUrl}/timetable/server/ttviewer.js?__func=getTTViewerData&ESID=`,
      {
        body: JSON.stringify({
          __args: [null, getCurrentSchoolYear()],
          __gsh: '00000000',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    if (!response.ok) {
      throw new Error(
        `EduPage listing request failed with status ${response.status}`,
      );
    }

    return ListingResponseSchema.parse(await response.json());
  }

  private async fetchTimetable(
    baseUrl: string,
    ttNum: string,
  ): Promise<TimetableResponse> {
    const response = await fetchWithTimeout(
      `${baseUrl}/timetable/server/regulartt.js?__func=regularttGetData&ESID=`,
      {
        body: JSON.stringify({ __args: [null, ttNum], __gsh: '00000000' }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    if (!response.ok) {
      throw new Error(
        `EduPage timetable request failed with status ${response.status}`,
      );
    }

    return TimetableResponseSchema.parse(await response.json());
  }

  private resolveCards(timetable: TimetableResponse): ResolvedCard[] {
    const tables = timetable.r.dbiAccessorRes.tables;
    const findTable = (id: string) =>
      tables.find((table) => table.id === id)?.data_rows ?? [];

    const classes = createRowMap(findTable('classes'));
    const classrooms = createRowMap(findTable('classrooms'));
    const lessons = createRowMap(findTable('lessons'));
    const periods = createRowMap(findTable('periods'));
    const subjects = createRowMap(findTable('subjects'));
    const teachers = createRowMap(findTable('teachers'));

    return findTable('cards')
      .map((card): ResolvedCard => {
        const cardId = getRowId(card) || getStringValue(card, ['cardid']);
        const lesson = lessons.get(
          getStringValue(card, ['lessonid', 'lesson_id']),
        );
        const subject = subjects.get(
          getStringValue(lesson, ['subjectid', 'subject_id']),
        );
        const periodId = getStringValue(card, [
          'period',
          'periodid',
          'period_id',
        ]);

        return {
          cardId,
          classes: resolveNames(
            getStringList(lesson, ['classids', 'class_ids', 'classes']),
            classes,
          ),
          classrooms: resolveNames(
            [
              ...getStringList(lesson, [
                'classroomids',
                'classroom_ids',
                'classrooms',
              ]),
              ...getStringList(card, [
                'classroomids',
                'classroom_ids',
                'classrooms',
              ]),
            ],
            classrooms,
          ),
          day: getDayName(getStringValue(card, ['days', 'day'])),
          durationPeriods:
            getStringValue(card, [
              'durationperiods',
              'durationPeriods',
              'duration',
            ]) ||
            getStringValue(lesson, [
              'durationperiods',
              'durationPeriods',
              'duration',
            ]),
          period: getPeriodText(periods.get(periodId), periodId),
          subject: getDisplayName(subject),
          teachers: resolveNames(
            getStringList(lesson, ['teacherids', 'teacher_ids', 'teachers']),
            teachers,
          ),
          weeks: getStringValue(card, ['weeks', 'week']),
        };
      })
      .filter(({ cardId }) => cardId !== '')
      .sort((a, b) => CARD_ID_COLLATOR.compare(a.cardId, b.cardId));
  }
}
