import {
  bold,
  ContainerBuilder,
  heading,
  SeparatorSpacingSize,
} from 'discord.js';
import { z } from 'zod';

import type { PostData } from '../lib/Post.js';
import type {
  ScraperStrategy,
  StrategyContext,
  StrategyResult,
} from '../lib/Scraper.js';

import { getSnapshot, setSnapshot } from '../utils/cache.js';
import { truncateString } from '../utils/components.js';

const SPLIT_REGEX = /[,;]/u;
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

const FIELD_LABELS: Record<CardField, string> = {
  classes: 'Групи',
  classrooms: 'Простории',
  day: 'Ден',
  durationPeriods: 'Траење',
  period: 'Час',
  subject: 'Предмет',
  teachers: 'Наставници',
  weeks: 'Недели',
};

const getCurrentSchoolYear = (): number => {
  const now = new Date();

  return now.getMonth() < 7 ? now.getFullYear() - 1 : now.getFullYear();
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

const stringifyValue = (value: ResolvedCard[CardField]): string =>
  Array.isArray(value) ? value.join(', ') || '—' : value || '—';

const stableStringify = (card: ResolvedCard): string =>
  JSON.stringify({
    cardId: card.cardId,
    classes: card.classes,
    classrooms: card.classrooms,
    day: card.day,
    durationPeriods: card.durationPeriods,
    period: card.period,
    subject: card.subject,
    teachers: card.teachers,
    weeks: card.weeks,
  });

const formatTimetableRange = (timetable: ListingTimetable): string => {
  const dateFrom = getStringValue(timetable, ['datefrom']);
  const dateTo = getStringValue(timetable, ['dateto']);

  if (dateFrom === '' && dateTo === '') {
    return 'Нема наведен период.';
  }

  return `${dateFrom || '?'} - ${dateTo || '?'}`;
};

const parseListingSnapshot = (
  snapshot: string | undefined,
): undefined | z.infer<typeof ListingSnapshotSchema> => {
  if (snapshot === undefined) {
    return undefined;
  }

  const parsed = ListingSnapshotSchema.safeParse(JSON.parse(snapshot));

  return parsed.success ? parsed.data : undefined;
};

const parseCardsSnapshot = (
  snapshot: string | undefined,
): ResolvedCard[] | undefined => {
  if (snapshot === undefined) {
    return undefined;
  }

  const parsed = ResolvedCardsSnapshotSchema.safeParse(JSON.parse(snapshot));

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
    const timetable = await this.fetchTimetable(
      link,
      currentListingSnapshot.defaultNum,
    );
    const currentCards = this.resolveCards(timetable);
    const cardsKey = `cards:${currentListingSnapshot.defaultNum}`;
    const previousCards = parseCardsSnapshot(getSnapshot(scraperId, cardsKey));

    const commit = () => {
      setSnapshot(scraperId, 'listing', JSON.stringify(currentListingSnapshot));
      setSnapshot(scraperId, cardsKey, JSON.stringify(currentCards));
    };

    if (previousListingSnapshot === undefined || previousCards === undefined) {
      commit();

      return { commit: () => {}, posts: [] };
    }

    const posts = [
      ...this.getTimetableChanges(
        listing.r.regular.timetables,
        currentListingSnapshot.defaultNum,
        previousListingSnapshot,
      ),
      ...this.getCardChanges(
        currentListingSnapshot.defaultNum,
        previousCards,
        currentCards,
      ),
    ];

    return { commit, posts };
  }

  private createCardChangePost(options: {
    cardId: string;
    currentCard: ResolvedCard | undefined;
    previousCard: ResolvedCard | undefined;
    ttNum: string;
  }): PostData {
    const { cardId, currentCard, previousCard, ttNum } = options;
    const subject =
      currentCard?.subject ?? previousCard?.subject ?? 'Непознат предмет';
    const timestamp = Date.now();
    const lines = CARD_FIELDS.flatMap((field) => {
      const previousValue = previousCard?.[field] ?? '';
      const currentValue = currentCard?.[field] ?? '';

      if (stringifyValue(previousValue) === stringifyValue(currentValue)) {
        return [];
      }

      return [
        bold(FIELD_LABELS[field]),
        `${bold('Пред:')} ${truncateString(stringifyValue(previousValue), 250)}`,
        `${bold('После:')} ${truncateString(stringifyValue(currentValue), 250)}`,
      ];
    });

    const component = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          heading(truncateString(subject, 200), 3),
        ),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(lines.join('\n')),
      );

    return {
      component,
      id: `change:${ttNum}:${cardId}:${timestamp}`,
    };
  }

  private createDefaultChangedPost(timetable: ListingTimetable): PostData {
    const component = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(heading('Нов активен распоред', 2)),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          `${bold('Распоред:')} ${truncateString(getDisplayName(timetable), 300)}\n${bold('Период:')} ${formatTimetableRange(timetable)}`,
        ),
      );

    return {
      component,
      id: `default-tt:${timetable.tt_num}`,
    };
  }

  private createNewTimetablePost(timetable: ListingTimetable): PostData {
    const component = new ContainerBuilder()
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(heading('Нов распоред на EduPage', 2)),
      )
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(
          `${bold('Распоред:')} ${truncateString(getDisplayName(timetable), 300)}\n${bold('Период:')} ${formatTimetableRange(timetable)}`,
        ),
      );

    return {
      component,
      id: `new-tt:${timetable.tt_num}`,
    };
  }

  private async fetchListing(baseUrl: string): Promise<ListingResponse> {
    const response = await fetch(
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

    return ListingResponseSchema.parse(await response.json());
  }

  private async fetchTimetable(
    baseUrl: string,
    ttNum: string,
  ): Promise<TimetableResponse> {
    const response = await fetch(
      `${baseUrl}/timetable/server/regulartt.js?__func=regularttGetData&ESID=`,
      {
        body: JSON.stringify({ __args: [null, ttNum], __gsh: '00000000' }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    return TimetableResponseSchema.parse(await response.json());
  }

  private getCardChanges(
    ttNum: string,
    previousCards: ResolvedCard[],
    currentCards: ResolvedCard[],
  ): PostData[] {
    const currentCardMap = new Map(
      currentCards.map((card) => [card.cardId, card]),
    );
    const previousCardMap = new Map(
      previousCards.map((card) => [card.cardId, card]),
    );
    const cardIds = new Set([
      ...previousCardMap.keys(),
      ...currentCardMap.keys(),
    ]);
    return [...cardIds].flatMap((cardId) => {
      const previousCard = previousCardMap.get(cardId);
      const currentCard = currentCardMap.get(cardId);

      if (
        previousCard !== undefined &&
        currentCard !== undefined &&
        stableStringify(previousCard) === stableStringify(currentCard)
      ) {
        return [];
      }

      return [
        this.createCardChangePost({ cardId, currentCard, previousCard, ttNum }),
      ];
    });
  }

  private getTimetableChanges(
    timetables: ListingTimetable[],
    defaultNum: string,
    previousSnapshot: z.infer<typeof ListingSnapshotSchema>,
  ): PostData[] {
    const previousTtNums = new Set(previousSnapshot.ttNums);
    const timetablePosts = timetables
      .filter(({ tt_num: ttNum }) => !previousTtNums.has(ttNum))
      .map((timetable) => this.createNewTimetablePost(timetable));

    if (defaultNum === previousSnapshot.defaultNum) {
      return timetablePosts;
    }

    const defaultTimetable = timetables.find(
      ({ tt_num: ttNum }) => ttNum === defaultNum,
    );

    return defaultTimetable === undefined
      ? timetablePosts
      : [...timetablePosts, this.createDefaultChangedPost(defaultTimetable)];
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
      .sort((a, b) => a.cardId.localeCompare(b.cardId));
  }
}
