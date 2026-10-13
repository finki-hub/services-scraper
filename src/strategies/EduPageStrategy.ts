import { hyperlink, TextDisplayBuilder } from 'discord.js';
import { z } from 'zod';

import type { PostData } from '../lib/Post.js';
import type {
  ScraperStrategy,
  StrategyContext,
  StrategyResult,
} from '../lib/Scraper.js';

import { getSnapshot, setSnapshots } from '../utils/cache.js';
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

const ResolvedCardSchema = z.object({
  cardId: z.string(),
  classes: z.array(z.string()),
  classrooms: z.array(z.string()),
  day: z.string(),
  durationPeriods: z.string(),
  period: z.string(),
  subject: z.string(),
  teachers: z.array(z.string()),
  weeks: z.string(),
});

const ResolvedCardsSnapshotSchema = z.array(ResolvedCardSchema);

type CardField = Exclude<keyof ResolvedCard, 'cardId'>;
type ListingResponse = z.infer<typeof ListingResponseSchema>;
type ListingTimetable = z.infer<typeof ListingTimetableSchema>;
type RawRow = z.infer<typeof RawRowSchema>;
type ResolvedCard = z.infer<typeof ResolvedCardSchema>;

type TimetableResponse = z.infer<typeof TimetableResponseSchema>;

const CARD_FIELDS: CardField[] = [
  'subject',
  'teachers',
  'classes',
  'classrooms',
  'day',
  'period',
  'weeks',
  'durationPeriods',
];

const compareExactStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

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

  if (composedName !== '') {
    return composedName;
  }

  return (
    getStringValue(row, ['name', 'short', 'abbr', 'caption', 'text']) || '?'
  );
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

const cardContentKey = (card: ResolvedCard): string =>
  JSON.stringify(
    CARD_FIELDS.map((field) => {
      const value = card[field];
      if (Array.isArray(value)) {
        return [field, value.toSorted(compareExactStrings)];
      }

      return [field, value];
    }),
  );

const hasUnmatchedCurrentCards = (
  previousCards: ResolvedCard[],
  currentCards: ResolvedCard[],
): boolean => {
  const previousCounts = new Map<string, number>();
  for (const card of previousCards) {
    const key = cardContentKey(card);
    previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1);
  }

  for (const card of currentCards) {
    const key = cardContentKey(card);
    const previousCount = previousCounts.get(key) ?? 0;
    if (previousCount === 0) return true;

    previousCounts.set(key, previousCount - 1);
  }

  // Unmatched old cards are removals/deactivations; keep those silent.
  return false;
};

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
    const cardsKey = `cards:${currentListingSnapshot.defaultNum}`;
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

    const hasTimetableUpdates = this.hasTimetableUpdates(
      listing.r.regular.timetables,
      currentListingSnapshot.defaultNum,
      previousListingSnapshot,
    );
    const hasCardUpdates =
      previousCards !== undefined &&
      previousListingSnapshot.ttNums.includes(
        currentListingSnapshot.defaultNum,
      ) &&
      hasUnmatchedCurrentCards(previousCards, currentCards);
    const posts =
      hasTimetableUpdates || hasCardUpdates
        ? [this.createUpdatePost(link, currentListingSnapshot.defaultNum)]
        : [];

    return { commit, posts };
  }

  private createUpdatePost(link: string, defaultNum: string): PostData {
    return {
      component: new TextDisplayBuilder().setContent(
        `Промени во распоредот се достапни на ${hyperlink('EduPage', link)}.`,
      ),
      id: `edupage-update:${defaultNum}:${Date.now()}`,
    };
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

  private hasTimetableUpdates(
    timetables: ListingTimetable[],
    defaultNum: string,
    previousSnapshot: z.infer<typeof ListingSnapshotSchema>,
  ): boolean {
    const previousTtNums = new Set(previousSnapshot.ttNums);
    const hasNewTimetable = timetables.some(
      ({ tt_num: ttNum }) => !previousTtNums.has(ttNum),
    );
    const hasNewActiveTimetable =
      defaultNum !== '' && defaultNum !== previousSnapshot.defaultNum;

    return hasNewTimetable || hasNewActiveTimetable;
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
          durationPeriods: getStringValue(card, [
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
