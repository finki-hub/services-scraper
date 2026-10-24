import { describe, expect, it } from 'vitest';

import {
  type CardDiff,
  createTimetableUpdateComponent,
  diffCards,
  type ResolvedCard,
} from '../src/utils/edupage.js';

const LINK = 'https://finki.edupage.org';
const MAX_MESSAGE_TEXT_LENGTH = 4_000;

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

  it('adds the start date only when the timetable name has no date range', () => {
    const content = JSON.stringify(
      createTimetableUpdateComponent({
        activatedTimetable: {
          dateFrom: '2026-10-10',
          name: 'raspored-zimski (10/10/2026 - 15/1/2027)',
        },
        cardDiff: undefined,
        link: LINK,
        publishedTimetables: [{ dateFrom: '2026-10-10', name: 'raspored' }],
      }).toJSON(),
    );

    expect(content).toContain('**Нов распоред:** raspored (од 10.10.2026)');
    expect(content).toContain(
      '**Активен распоред:** raspored-zimski (10/10/2026 - 15/1/2027)"',
    );
  });

  it('escapes Discord markdown in EduPage names', () => {
    const content = renderChanges({
      added: [card('*1', '**Bold** _subject_')],
      removed: [],
    });

    expect(content).toContain(String.raw`\\*\\*Bold\\*\\* \\_subject\\_`);
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

  it('summarizes large updates by counts and affected subjects', () => {
    const removed = Array.from({ length: 20 }, (_, index) =>
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
      'Распоредот е значително ажуриран: 20 изменети, 1 нови часови.',
    );
    expect(content).toContain('**Засегнати предмети:** Math, Physics');
    expect(content).not.toContain('Изменети часови');
  });

  it('stays within Discord text and component limits with long names', () => {
    const longName = 'Предмет '.repeat(100);
    const added = Array.from({ length: 30 }, (_, index) =>
      card(`*${index}`, `${longName}${index}`, {
        classes: ['Група '.repeat(50)],
        teachers: ['Наставник '.repeat(50)],
      }),
    );
    const component = createTimetableUpdateComponent({
      activatedTimetable: { dateFrom: '2026-10-04', name: longName },
      cardDiff: { added, removed: [] },
      link: LINK,
      publishedTimetables: [{ dateFrom: '2026-10-04', name: longName }],
    }).toJSON();

    expect(getTextLength(component)).toBeLessThan(MAX_MESSAGE_TEXT_LENGTH);
    expect(component.components).toHaveLength(6);
  });
});
