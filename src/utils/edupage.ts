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
  activatedTimetable: TimetableInfo | undefined;
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

const MAX_DETAILED_CARDS = 30;
const MAX_LISTED_CHANGES = 15;
const MAX_LINE_LENGTH = 200;
const MAX_SUBJECTS_LENGTH = 1_000;
const MAX_TIMETABLE_NAME_LENGTH = 200;
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

const formatFieldValue = (card: ResolvedCard, field: CardField): string => {
  const value = sortedValues(card[field]);
  const text = Array.isArray(value) ? value.join(', ') : value;

  return text === '' ? '-' : escapeMarkdown(text);
};

const formatDate = (date: string): string => {
  const groups = ISO_DATE_REGEX.exec(date)?.groups;

  return groups === undefined
    ? date
    : `${groups['day']}.${groups['month']}.${groups['year']}`;
};

const formatLessonLabel = (card: ResolvedCard): string => {
  const subject = bold(escapeMarkdown(card.subject));

  return card.classes.length === 0
    ? subject
    : `${subject} (${escapeMarkdown(card.classes.join(', '))})`;
};

const formatCardDetails = (card: ResolvedCard): string => {
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
    .map((part) => escapeMarkdown(part))
    .join(', ');
};

const formatChangedFields = (
  previousCard: ResolvedCard,
  currentCard: ResolvedCard,
): string =>
  CHANGEABLE_FIELDS.map((field) => {
    const previousValue = formatFieldValue(previousCard, field);
    const currentValue = formatFieldValue(currentCard, field);

    return previousValue === currentValue
      ? ''
      : `${FIELD_LABELS[field]}: ~~${previousValue}~~ → ${currentValue}`;
  })
    .filter((part) => part !== '')
    .join('; ');

const formatTimetable = (title: string, timetable: TimetableInfo): string => {
  const name = escapeMarkdown(
    truncateString(timetable.name, MAX_TIMETABLE_NAME_LENGTH),
  );
  const date =
    timetable.dateFrom === '' || NAME_DATE_REGEX.test(timetable.name)
      ? ''
      : ` (од ${formatDate(timetable.dateFrom)})`;

  return `${bold(title)} ${name}${date}`;
};

const groupByLesson = (cards: ResolvedCard[]): Map<string, ResolvedCard[]> => {
  const groups = new Map<string, ResolvedCard[]>();

  for (const card of cards) {
    const key = lessonKey(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }

  return groups;
};

const compareCards = (left: ResolvedCard, right: ResolvedCard): number =>
  NAME_COLLATOR.compare(formatLessonLabel(left), formatLessonLabel(right)) ||
  NAME_COLLATOR.compare(formatCardDetails(left), formatCardDetails(right));

const toEntries = (cards: ResolvedCard[], label: string): ChangeEntry[] =>
  cards.toSorted(compareCards).map((card) => ({
    label,
    text: truncateString(
      `${formatLessonLabel(card)}: ${formatCardDetails(card)}`,
      MAX_LINE_LENGTH,
    ),
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

  const changedEntries = changed
    .toSorted(([, left], [, right]) => compareCards(left, right))
    .map(([previousCard, currentCard]) => ({
      label: CHANGED_LABEL,
      text: truncateString(
        `${formatLessonLabel(currentCard)}: ${formatChangedFields(previousCard, currentCard)}`,
        MAX_LINE_LENGTH,
      ),
    }));

  return [
    ...changedEntries,
    ...toEntries(unpairedAdded, ADDED_LABEL),
    ...toEntries(unpairedRemoved, REMOVED_LABEL),
  ];
};

const formatDetailedChanges = (diff: CardDiff): string => {
  const entries = getChangeEntries(diff);
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

const formatSummarizedChanges = (diff: CardDiff): string => {
  const { added, removed } = diff;
  const entries = getChangeEntries(diff);
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
    .map((subject) => escapeMarkdown(subject));

  return [
    `Распоредот е значително ажуриран: ${counts.join(', ')} часови.`,
    `${bold('Засегнати предмети:')} ${truncateString(subjects.join(', '), MAX_SUBJECTS_LENGTH)}`,
  ].join('\n');
};

export const diffCards = (
  previousCards: ResolvedCard[],
  currentCards: ResolvedCard[],
): CardDiff => {
  const unmatchedPrevious = new Map<string, ResolvedCard[]>();

  for (const card of previousCards) {
    const key = cardContentKey(card);
    unmatchedPrevious.set(key, [...(unmatchedPrevious.get(key) ?? []), card]);
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
  const timetableLines = [
    ...publishedTimetables.map((timetable) =>
      formatTimetable('Нов распоред:', timetable),
    ),
    ...(activatedTimetable === undefined
      ? []
      : [formatTimetable('Активен распоред:', activatedTimetable)]),
  ];

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
    const changes =
      cardDiff.added.length + cardDiff.removed.length > MAX_DETAILED_CARDS
        ? formatSummarizedChanges(cardDiff)
        : formatDetailedChanges(cardDiff);

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
