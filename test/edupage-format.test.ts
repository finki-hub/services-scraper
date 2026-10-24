import { describe, expect, it } from 'vitest';

import {
  type CardDiff,
  createTimetableUpdateComponent,
  diffCards,
  type ResolvedCard,
} from '../src/utils/edupage.js';

const LINK = 'https://finki.edupage.org';
const MAX_MESSAGE_TEXT_LENGTH = 4_000;
const WORST_CASE_NAME = '**Предмет** _'.repeat(100);
const WORST_CASE_LIST = Array.from(
  { length: 50 },
  (_, index) => `~~Име ${index}`,
);
const WORST_CASE_CLASSROOMS = WORST_CASE_LIST.toReversed().map(
  (item) => `${item}!`,
);
const WORST_CASE_TEACHERS = WORST_CASE_LIST.map((item) => `${item}?`);

const card = (
  cardId: string,
  subject: string,
  overrides: Partial<ResolvedCard> = {},
): ResolvedCard => ({
  cardId,
  classes: ['1г-СЕИС'],
  classrooms: ['Амфи 2.1'],
  day: 'Понеделник',
  durationPeriods: '2',
  period: '08:00 - 08:45',
  subject,
  teachers: ['Ада Лавлејс'],
  weeks: '1',
  ...overrides,
});

const renderChanges = (cardDiff: CardDiff): string =>
  JSON.stringify(
    createTimetableUpdateComponent({
      activatedTimetable: undefined,
      cardDiff,
      link: LINK,
      publishedTimetables: [],
    }).toJSON(),
  );

const getTextLength = (component: unknown): number => {
  const node = component as { components?: unknown[]; content?: unknown };
  const ownLength = typeof node.content === 'string' ? node.content.length : 0;

  return (node.components ?? []).reduce<number>(
    (total, child) => total + getTextLength(child),
    ownLength,
  );
};

describe('diffCards', () => {
  it('ignores card ID renumbering, reordering and list order', () => {
    const previous = [
      card('*1', 'Math', { teachers: ['A', 'B'] }),
      card('*2', 'Physics'),
    ];
    const current = [
      card('*7', 'Physics'),
      card('*8', 'Math', { teachers: ['B', 'A'] }),
    ];

    expect(diffCards(previous, current)).toStrictEqual({
      added: [],
      removed: [],
    });
  });

  it('keeps duplicate multiplicity when matching lessons', () => {
    const previous = [card('*1', 'Math'), card('*2', 'Math')];
    const current = [card('*3', 'Math')];

    const { added, removed } = diffCards(previous, current);

    expect(added).toStrictEqual([]);
    expect(removed).toHaveLength(1);
  });
});

describe('createTimetableUpdateComponent', () => {
  it('shows an unambiguous moved lesson as a field change', () => {
    const content = renderChanges({
      added: [card('*9', 'Math', { classrooms: ['Б 3.2'], day: 'Среда' })],
      removed: [card('*1', 'Math')],
    });

    expect(content).toContain('Изменети часови');
    expect(content).toContain(
      '**Math** (1г-СЕИС): Ден: ~~Понеделник~~ → Среда; Простории: ~~Амфи 2.1~~ → Б 3.2',
    );
  });

  it('lists ambiguous lesson groups as additions and removals', () => {
    const content = renderChanges({
      added: [card('*9', 'Math', { day: 'Среда' })],
      removed: [
        card('*1', 'Math', { day: 'Вторник' }),
        card('*2', 'Math', { day: 'Четврток' }),
      ],
    });

    expect(content).not.toContain('Изменети часови');
    expect(content).toContain(
      '**Math** (1г-СЕИС): Среда, 08:00 - 08:45, 2 часа, Амфи 2.1, Ада Лавлејс',
    );
    expect(content).toContain('Отстранети часови');
    expect(content).toContain('**Math** (1г-СЕИС): Вторник');
    expect(content).toContain('**Math** (1г-СЕИС): Четврток');
  });

  it('does not pair lessons of different groups', () => {
    const content = renderChanges({
      added: [card('*9', 'Math', { classes: ['2г-КНИ'] })],
      removed: [card('*1', 'Math')],
    });

    expect(content).toContain('Нови часови');
    expect(content).toContain('Отстранети часови');
  });
});

describe('createTimetableUpdateComponent formatting and limits', () => {
  it('adds the start date only when the timetable name has no date range', () => {
    const content = JSON.stringify(
      createTimetableUpdateComponent({
        activatedTimetable: {
          dateFrom: '2026-10-10',
          isNew: false,
          name: 'raspored-zimski (10/10/2026 - 15/1/2027)',
        },
        cardDiff: undefined,
        link: LINK,
        publishedTimetables: [{ dateFrom: '2026-10-10', name: 'raspored' }],
      }).toJSON(),
    );

    expect(content).toContain('**Нов распоред:** raspored (од 10.10.2026)');
    expect(content).toContain(
      '**Активен распоред:** raspored-zimski (10/10/2026 - 15/1/2027)',
    );
    expect(content).not.toContain(String.raw`(од 10.10.2026)\n**Активен`);
  });

  it('caps timetable announcements and keeps the active one first', () => {
    const content = JSON.stringify(
      createTimetableUpdateComponent({
        activatedTimetable: { dateFrom: '', isNew: true, name: 'active' },
        cardDiff: undefined,
        link: LINK,
        publishedTimetables: Array.from({ length: 25 }, (_, index) => ({
          dateFrom: '',
          name: `published-${index}`,
        })),
      }).toJSON(),
    );

    expect(content).toContain('**Нов активен распоред:** active');
    expect(content).toContain('published-1');
    expect(content).not.toContain('published-2');
    expect(content).toContain('+ уште 23 распореди');
  });

  it('escapes Discord markdown in EduPage names', () => {
    const content = renderChanges({
      added: [card('*1', '**Bold** _subject_')],
      removed: [],
    });

    expect(content).toContain(String.raw`\\*\\*Bold\\*\\* \\_subject\\_`);
  });

  it('shortens long values without breaking Markdown pairs', () => {
    const teachers = Array.from(
      { length: 20 },
      (_, index) => `Наставник ${index}`,
    );
    const content = createTimetableUpdateComponent({
      activatedTimetable: undefined,
      cardDiff: {
        added: [card('*2', 'Math', { classrooms: ['Б 3.2'], teachers })],
        removed: [card('*1', 'Math', { teachers: ['Ада'] })],
      },
      link: LINK,
      publishedTimetables: [],
    })
      .toJSON()
      .components.map((component) => JSON.stringify(component))
      .join('\n');
    const changeLine = content
      .split(String.raw`\n`)
      .find((line) => line.startsWith('- **Math**'));

    expect(changeLine).toBeDefined();
    expect(changeLine?.split('~~').length).toBe(5);
    expect(changeLine?.split('**').length).toBe(3);
  });

  it('caps the detailed list and counts the remaining changes', () => {
    const added = Array.from({ length: 20 }, (_, index) =>
      card(`*${index}`, `Subject ${String(index).padStart(2, '0')}`),
    );

    const content = renderChanges({ added, removed: [] });

    expect(content).toContain('Subject 14');
    expect(content).not.toContain('Subject 15');
    expect(content).toContain('+ уште 5 промени');
  });

  it('keeps moderate paired updates detailed even when raw counts are high', () => {
    const removed = Array.from({ length: 16 }, (_, index) =>
      card(`*${index}`, `Subject ${String(index).padStart(2, '0')}`),
    );
    const added = removed.map((lesson, index) => ({
      ...lesson,
      cardId: `*${index + 100}`,
      classrooms: ['Б 3.2'],
    }));

    const content = renderChanges({ added, removed });

    expect(content).toContain('Изменети часови');
    expect(content).toContain('+ уште 1 промени');
    expect(content).not.toContain('значително ажуриран');
  });

  it('summarizes large updates by counts and affected subjects', () => {
    const removed = Array.from({ length: 40 }, (_, index) =>
      card(`*${index}`, index % 2 === 0 ? 'Math' : 'Physics', {
        classes: [`Група ${index}`],
      }),
    );
    const added = removed.map((lesson, index) => ({
      ...lesson,
      cardId: `*${index + 100}`,
      day: 'Петок',
    }));

    const content = renderChanges({
      added: [...added, card('*999', 'Physics', { classes: ['Нова група'] })],
      removed,
    });

    expect(content).toContain(
      'Распоредот е значително ажуриран: 40 изменети, 1 нови часови.',
    );
    expect(content).toContain('**Засегнати предмети:** Math, Physics');
    expect(content).not.toContain('Изменети часови');
  });

  it('stays within Discord text and component limits in the worst case', () => {
    const longName = WORST_CASE_NAME;
    const removed = Array.from({ length: 15 }, (_, index) =>
      card(`*${index}`, `${longName}${index}`, {
        classes: WORST_CASE_LIST,
        classrooms: WORST_CASE_LIST,
        teachers: WORST_CASE_LIST,
      }),
    );
    const added = removed.map((lesson, index) => ({
      ...lesson,
      cardId: `*${index + 100}`,
      classrooms: WORST_CASE_CLASSROOMS,
      day: 'Петок',
      durationPeriods: '3',
      period: longName,
      teachers: WORST_CASE_TEACHERS,
      weeks: longName,
    }));
    const component = createTimetableUpdateComponent({
      activatedTimetable: {
        dateFrom: '2026-10-04',
        isNew: true,
        name: longName,
      },
      cardDiff: { added: [...added, ...removed.slice(0, 1)], removed },
      link: `${LINK}/${'x'.repeat(200)}`,
      publishedTimetables: Array.from({ length: 30 }, () => ({
        dateFrom: '2026-10-04',
        name: longName,
      })),
    }).toJSON();

    expect(getTextLength(component)).toBeLessThan(MAX_MESSAGE_TEXT_LENGTH);
    expect(component.components).toHaveLength(6);
  });
});
