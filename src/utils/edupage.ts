import {
  bold,
  ContainerBuilder,
  escapeMarkdown,
  heading,
  HeadingLevel,
  hyperlink,
  SeparatorSpacingSize,
} from 'discord.js';
import { z } from 'zod';

import { truncateString } from './components.js';

export const ResolvedCardSchema = z.object({
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

export type ActivatedTimetable = TimetableInfo & {
  isNew: boolean;
};

export type CardDiff = {
  added: ResolvedCard[];
  removed: ResolvedCard[];
};

export type ResolvedCard = z.infer<typeof ResolvedCardSchema>;

export type TimetableInfo = {
  dateFrom: string;
  name: string;
};

export type TimetableUpdate = {
  activatedTimetable: ActivatedTimetable | undefined;
  cardDiff: CardDiff | undefined;
  link: string;
  publishedTimetables: TimetableInfo[];
};

type CardField = Exclude<keyof ResolvedCard, 'cardId'>;

type ChangeEntry = {
  label: string;
  text: string;
};

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

// Fields that can change while a lesson is still recognizably the same one.
const CHANGEABLE_FIELDS: CardField[] = [
  'day',
  'period',
  'durationPeriods',
  'classrooms',
  'teachers',
  'weeks',
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

const CHANGED_LABEL = 'Изменети часови';
const ADDED_LABEL = 'Нови часови';
const REMOVED_LABEL = 'Отстранети часови';

const SUMMARY_COUNTS = [
  [CHANGED_LABEL, 'изменети'],
  [ADDED_LABEL, 'нови'],
  [REMOVED_LABEL, 'отстранети'],
] as const;

// These bounds keep the whole message well under Discord's 4000-character limit.
const MAX_DETAILED_ENTRIES = 30;
const MAX_LISTED_CHANGES = 15;
const MAX_LISTED_TIMETABLES = 3;
const MAX_LINE_LENGTH = 160;
const MAX_NAME_LENGTH = 60;
const MAX_VALUE_LENGTH = 32;
const MAX_SUBJECTS_LENGTH = 1_000;
const MAX_TIMETABLE_NAME_LENGTH = 100;
const ISO_DATE_REGEX = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
// FINKI timetable names usually embed their range, e.g. "(10/10/2026 - 15/1/2027)".
const NAME_DATE_REGEX = /\d{1,2}\/\d{1,2}/u;
const NAME_COLLATOR = new Intl.Collator('mk');

const compareExactStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

const sortedValues = (value: string | string[]): string | string[] =>
  Array.isArray(value) ? value.toSorted(compareExactStrings) : value;

const cardContentKey = (card: ResolvedCard): string =>
  JSON.stringify(
    CARD_FIELDS.map((field) => [field, sortedValues(card[field])]),
  );

const lessonKey = (card: ResolvedCard): string =>
  JSON.stringify([card.subject, sortedValues(card.classes)]);

const appendToGroup = <T>(
  groups: Map<string, T[]>,
  key: string,
  item: T,
): void => {
  const group = groups.get(key);

  if (group === undefined) {
    groups.set(key, [item]);
  } else {
    group.push(item);
  }
};

// Escaping before truncating means a cut can only split an escape sequence,
// never a ** or ~~ pair added around the value.
const safeText = (text: string, maxLength: number): string =>
  truncateString(escapeMarkdown(text), maxLength);

// Always keeps the first part, then adds whole parts while they fit.
const joinWithinLimit = (
  parts: string[],
  separator: string,
  maxLength: number,
): string => {
  const [first = '', ...rest] = parts;
  let text = first;

  for (const part of rest) {
    const next = `${text}${separator}${part}`;

    if (next.length > maxLength) {
      return `${text}${separator}...`;
    }

    text = next;
  }

  return text;
};

const formatFieldValue = (card: ResolvedCard, field: CardField): string => {
  const value = sortedValues(card[field]);
  const text = Array.isArray(value) ? value.join(', ') : value;

  return text === '' ? '-' : safeText(text, MAX_VALUE_LENGTH);
};

const formatDate = (date: string): string => {
  const groups = ISO_DATE_REGEX.exec(date)?.groups;

  return groups === undefined
    ? date
    : `${groups['day']}.${groups['month']}.${groups['year']}`;
};

const formatLessonLabel = (card: ResolvedCard): string => {
  const subject = bold(safeText(card.subject, MAX_NAME_LENGTH));

  return card.classes.length === 0
    ? subject
    : `${subject} (${safeText(card.classes.join(', '), MAX_VALUE_LENGTH)})`;
};

const getCardDetails = (card: ResolvedCard): string[] => {
  const duration =
    card.durationPeriods === '' || card.durationPeriods === '1'
      ? ''
      : `${card.durationPeriods} часа`;

  return [
    card.day,
    card.period,
    duration,
    card.classrooms.join(', '),
    card.teachers.join(', '),
  ]
    .filter((part) => part !== '')
    .map((part) => safeText(part, MAX_VALUE_LENGTH));
};

const getChangedFields = (
  previousCard: ResolvedCard,
  currentCard: ResolvedCard,
): string[] =>
  CHANGEABLE_FIELDS.map((field) => {
    const previousValue = formatFieldValue(previousCard, field);
    const currentValue = formatFieldValue(currentCard, field);

    return previousValue === currentValue
      ? ''
      : `${FIELD_LABELS[field]}: ~~${previousValue}~~ → ${currentValue}`;
  }).filter((part) => part !== '');

const formatEntryLine = (
  card: ResolvedCard,
  parts: string[],
  separator: string,
): string => {
  const label = formatLessonLabel(card);
  const details = joinWithinLimit(
    parts,
    separator,
    MAX_LINE_LENGTH - label.length,
  );

  return `${label}: ${details}`;
};

const formatTimetable = (title: string, timetable: TimetableInfo): string => {
  const name = safeText(timetable.name, MAX_TIMETABLE_NAME_LENGTH);
  const date =
    timetable.dateFrom === '' || NAME_DATE_REGEX.test(timetable.name)
      ? ''
      : ` (од ${formatDate(timetable.dateFrom)})`;

  return `${bold(title)} ${name}${date}`;
};

const formatTimetableLines = (
  publishedTimetables: TimetableInfo[],
  activatedTimetable: ActivatedTimetable | undefined,
): string[] => {
  const activeTitle = activatedTimetable?.isNew
    ? 'Нов активен распоред:'
    : 'Активен распоред:';
  const lines = [
    ...(activatedTimetable === undefined
      ? []
      : [formatTimetable(activeTitle, activatedTimetable)]),
    ...publishedTimetables.map((timetable) =>
      formatTimetable('Нов распоред:', timetable),
    ),
  ];
  const hiddenCount = lines.length - MAX_LISTED_TIMETABLES;

  return hiddenCount > 0
    ? [
        ...lines.slice(0, MAX_LISTED_TIMETABLES),
        `+ уште ${hiddenCount} распореди`,
      ]
    : lines;
};

const groupByLesson = (cards: ResolvedCard[]): Map<string, ResolvedCard[]> => {
  const groups = new Map<string, ResolvedCard[]>();

  for (const card of cards) {
    appendToGroup(groups, lessonKey(card), card);
  }

  return groups;
};

// Sort keys are computed once per item instead of on every comparison.
const sortByCard = <T>(items: T[], getCard: (item: T) => ResolvedCard): T[] =>
  items
    .map((item) => {
      const card = getCard(item);

      return {
        classes: card.classes.join(', '),
        details: getCardDetails(card).join(', '),
        item,
        subject: card.subject,
      };
    })
    .toSorted(
      (left, right) =>
        NAME_COLLATOR.compare(left.subject, right.subject) ||
        NAME_COLLATOR.compare(left.classes, right.classes) ||
        NAME_COLLATOR.compare(left.details, right.details),
    )
    .map(({ item }) => item);

const toEntries = (cards: ResolvedCard[], label: string): ChangeEntry[] =>
  sortByCard(cards, (card) => card).map((card) => ({
    label,
    text: formatEntryLine(card, getCardDetails(card), ', '),
  }));

const getChangeEntries = ({ added, removed }: CardDiff): ChangeEntry[] => {
  const addedGroups = groupByLesson(added);
  const removedGroups = groupByLesson(removed);
  const changed: Array<[ResolvedCard, ResolvedCard]> = [];
  const unpairedAdded: ResolvedCard[] = [];
  const unpairedRemoved: ResolvedCard[] = [];

  for (const [key, addedCards] of addedGroups) {
    const removedCards = removedGroups.get(key) ?? [];
    const [addedCard] = addedCards;
    const [removedCard] = removedCards;

    // Pair only when the group is unambiguous; otherwise list both sides as-is.
    if (
      addedCard !== undefined &&
      removedCard !== undefined &&
      addedCards.length === 1 &&
      removedCards.length === 1
    ) {
      changed.push([removedCard, addedCard]);
    } else {
      unpairedAdded.push(...addedCards);
      unpairedRemoved.push(...removedCards);
    }
  }

  for (const [key, removedCards] of removedGroups) {
    if (!addedGroups.has(key)) unpairedRemoved.push(...removedCards);
  }

  const changedEntries = sortByCard(
    changed,
    ([, currentCard]) => currentCard,
  ).map(([previousCard, currentCard]) => ({
    label: CHANGED_LABEL,
    text: formatEntryLine(
      currentCard,
      getChangedFields(previousCard, currentCard),
      '; ',
    ),
  }));

  return [
    ...changedEntries,
    ...toEntries(unpairedAdded, ADDED_LABEL),
    ...toEntries(unpairedRemoved, REMOVED_LABEL),
  ];
};

const formatDetailedChanges = (entries: ChangeEntry[]): string => {
  const lines: string[] = [];
  let currentLabel = '';

  for (const entry of entries.slice(0, MAX_LISTED_CHANGES)) {
    if (entry.label !== currentLabel) {
      currentLabel = entry.label;
      lines.push(bold(entry.label));
    }

    lines.push(`- ${entry.text}`);
  }

  const hiddenCount = entries.length - MAX_LISTED_CHANGES;

  if (hiddenCount > 0) {
    lines.push(`+ уште ${hiddenCount} промени`);
  }

  return lines.join('\n');
};

const formatSummarizedChanges = (
  { added, removed }: CardDiff,
  entries: ChangeEntry[],
): string => {
  const counts = SUMMARY_COUNTS.map(([label, word]) => ({
    count: entries.filter((entry) => entry.label === label).length,
    word,
  }))
    .filter(({ count }) => count > 0)
    .map(({ count, word }) => `${count} ${word}`);
  const subjects = [
    ...new Set([...added, ...removed].map((card) => card.subject)),
  ]
    .toSorted((left, right) => NAME_COLLATOR.compare(left, right))
    .map((subject) => safeText(subject, MAX_NAME_LENGTH));
  const subjectList = joinWithinLimit(subjects, ', ', MAX_SUBJECTS_LENGTH);

  return [
    `Распоредот е значително ажуриран: ${counts.join(', ')} часови.`,
    `${bold('Засегнати предмети:')} ${subjectList}`,
  ].join('\n');
};

export const diffCards = (
  previousCards: ResolvedCard[],
  currentCards: ResolvedCard[],
): CardDiff => {
  const unmatchedPrevious = new Map<string, ResolvedCard[]>();

  for (const card of previousCards) {
    appendToGroup(unmatchedPrevious, cardContentKey(card), card);
  }

  const added: ResolvedCard[] = [];

  for (const card of currentCards) {
    const matches = unmatchedPrevious.get(cardContentKey(card));

    if (matches === undefined || matches.length === 0) {
      added.push(card);
    } else {
      matches.pop();
    }
  }

  return { added, removed: unmatchedPrevious.values().toArray().flat() };
};

export const hasCardDiff = (diff: CardDiff | undefined): diff is CardDiff =>
  diff !== undefined && (diff.added.length > 0 || diff.removed.length > 0);

export const createTimetableUpdateComponent = ({
  activatedTimetable,
  cardDiff,
  link,
  publishedTimetables,
}: TimetableUpdate): ContainerBuilder => {
  const timetableLines = formatTimetableLines(
    publishedTimetables,
    activatedTimetable,
  );

  let container = new ContainerBuilder().addTextDisplayComponents(
    (textDisplayComponent) =>
      textDisplayComponent.setContent(
        heading('Промени во распоредот', HeadingLevel.Two),
      ),
  );

  if (timetableLines.length > 0) {
    container = container.addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(timetableLines.join('\n')),
    );
  }

  if (hasCardDiff(cardDiff)) {
    const entries = getChangeEntries(cardDiff);
    const changes =
      entries.length > MAX_DETAILED_ENTRIES
        ? formatSummarizedChanges(cardDiff, entries)
        : formatDetailedChanges(entries);

    container = container
      .addSeparatorComponents((separatorComponent) =>
        separatorComponent.setSpacing(SeparatorSpacingSize.Large),
      )
      .addTextDisplayComponents((textDisplayComponent) =>
        textDisplayComponent.setContent(changes),
      );
  }

  const timetableLink = hyperlink('EduPage', `${link}/timetable/`);

  return container
    .addSeparatorComponents((separatorComponent) =>
      separatorComponent.setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents((textDisplayComponent) =>
      textDisplayComponent.setContent(
        `Целиот распоред е достапен на ${timetableLink}.`,
      ),
    );
};
