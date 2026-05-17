import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PartnersStrategy } from '../src/strategies/PartnersStrategy.js';
import { TimetablesStrategy } from '../src/strategies/TimetablesStrategy.js';

const configModulePath = '../src/configuration/config.js';

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap(
      collectStrings,
    );
  }

  return [];
};

const loadElement = (html: string, selector: string): Cheerio<Element> => {
  const $: CheerioAPI = cheerio.load(html);

  return $(selector).first() as Cheerio<Element>;
};

afterEach(() => {
  vi.doUnmock(configModulePath);
  vi.resetModules();
});

describe('PartnersStrategy', () => {
  it('cleans partner labels and whitespace from text-only partner IDs', () => {
    const strategy = new PartnersStrategy();

    const $element = loadElement(
      '<div class="card"> Gold partner \n\t Example   Company </div>',
      'div',
    );

    expect(strategy.getId($element)).toBe('Example Company');
  });

  it('normalizes A1 partner links to a stable ID and display name', () => {
    const strategy = new PartnersStrategy();

    const $element = loadElement(
      '<div class="support"><a href="https://a1.mk/company">Gold partner Telekom</a></div>',
      'div',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(post.id).toBe('A1');
    expect(strings).toContain('A1');
    expect(strings).toContain('https://a1.mk/company');
    expect(strings).toContain('Нов партнер на ФИНКИ');
  });
});

describe('ActivitiesStrategy', () => {
  it('extracts activity ID, type, description, and link', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { ActivitiesStrategy } =
      await import('../src/strategies/ActivitiesStrategy.js');
    const strategy = new ActivitiesStrategy();
    const $element = loadElement(
      `
        <li class="activity item forum" data-id="42">
          <div class="activity-item" data-activityname="Forum updates"></div>
          <div class="activityname"><a href="https://courses.test/forum">Forum link</a></div>
          <div class="activity-altcontent">Read the forum before class.</div>
        </li>
      `,
      'li',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(strategy.getId($element)).toBe('42');
    expect(post.id).toBe('42');
    expect(strings).toContain('Forum updates');
    expect(strings).toContain('https://courses.test/forum');
    expect(strings).toContain('Тип:');
    expect(strings).toContain('Форум');
    expect(strings).toContain('Read the forum before class.');
  });

  it('builds cookie request init only when a cookie exists', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { ActivitiesStrategy } =
      await import('../src/strategies/ActivitiesStrategy.js');
    const strategy = new ActivitiesStrategy();
    const missingCookie: string | undefined = undefined;

    expect(strategy.getRequestInit(missingCookie)).toBeUndefined();
    expect(strategy.getRequestInit('MoodleSession=abc')).toStrictEqual({
      credentials: 'include',
      headers: {
        Cookie: 'MoodleSession=abc',
      },
    });
  });
});

describe('CourseStrategy', () => {
  it('uses fallbacks when optional author link, image, and content are missing', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { CourseStrategy } =
      await import('../src/strategies/CourseStrategy.js');
    const strategy = new CourseStrategy();
    const $element = loadElement(
      `
        <article>
          <a title="Permanent link to this post" href="/forum/post/1"></a>
          <div class="mb-3"><a>Teacher Name</a></div>
          <h4><a>Ignored</a><a>Lecture announcement</a></h4>
          <div class="post-content-container"></div>
        </article>
      `,
      'article',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(strategy.getId($element)).toBe('/forum/post/1');
    expect(post.id).toBe('/forum/post/1');
    expect(strings).toContain('Teacher Name');
    expect(strings).toContain('Lecture announcement');
    expect(strings).toContain('/forum/post/1');
    expect(strings).toContain('Нема опис.');
  });

  it('builds cookie request init only when a cookie exists', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { CourseStrategy } =
      await import('../src/strategies/CourseStrategy.js');
    const strategy = new CourseStrategy();
    const missingCookie: string | undefined = undefined;

    expect(strategy.getRequestInit(missingCookie)).toBeUndefined();
    expect(strategy.getRequestInit('MoodleSession=abc')).toStrictEqual({
      credentials: 'include',
      headers: {
        Cookie: 'MoodleSession=abc',
      },
    });
  });
});

describe('TimetablesStrategy', () => {
  it('collapses ID whitespace and normalizes relative links', () => {
    const strategy = new TimetablesStrategy();
    const $element = loadElement(
      '<div><a href="documents/schedule.pdf"> Summer \n timetable </a></div>',
      'div',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(strategy.getId($element)).toBe('Summer timetable');
    expect(post.id).toBe('Summer timetable');
    expect(strings).toContain('Summer timetable');
    expect(strings).toContain('https://finki.ukim.mk/documents/schedule.pdf');
  });
});

describe('InternshipsStrategy', () => {
  it('includes optional company, status, and deadline fields when present', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { InternshipsStrategy } =
      await import('../src/strategies/InternshipsStrategy.js');
    const strategy = new InternshipsStrategy();
    const $element = loadElement(
      `
        <div class="card">
          <h5 class="card-title">Junior Developer</h5>
          <p class="card-text">Build student services.</p>
          <p class="mb-2 text-secondary small"><i class="bi-building"></i><span>FINKI Hub</span></p>
          <p class="mb-0 text-secondary small"><i class="bi-calendar-x"></i><span><span>Активен до: 31.12.2026</span></span></p>
          <span class="badge">Active</span>
          <div class="card-footer"><a class="btn" href="/posting/42">Apply</a></div>
        </div>
      `,
      'div.card',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(post.id).toBe('https://internships.finki.ukim.mk/posting/42');
    expect(strings).toContain('Junior Developer');
    expect(strings).toContain('https://internships.finki.ukim.mk/posting/42');
    expect(strings).toContain('Build student services.');
    expect(strings).toContain('**Компанија:** FINKI Hub');
    expect(strings).toContain('**Статус:** Active');
    expect(strings).toContain('**Активен до:** 31.12.2026');
  });

  it('omits optional metadata when it is absent', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { InternshipsStrategy } =
      await import('../src/strategies/InternshipsStrategy.js');
    const strategy = new InternshipsStrategy();
    const $element = loadElement(
      `
        <div class="card">
          <h5 class="card-title">Internship</h5>
          <p class="card-text"></p>
        </div>
      `,
      'div.card',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(post.id).toBeNull();
    expect(strings).toContain('Internship');
    expect(strings).toContain('?');
    expect(strings).not.toContain('**Компанија:**');
    expect(strings).not.toContain('**Статус:**');
    expect(strings).not.toContain('**Активен до:**');
  });
});

describe('JobsStrategy, EventsStrategy, and ProjectsStrategy', () => {
  it.each([
    {
      exportName: 'JobsStrategy',
      modulePath: '../src/strategies/JobsStrategy.js',
      name: 'jobs',
      selector: 'div.views-row',
    },
    {
      exportName: 'EventsStrategy',
      modulePath: '../src/strategies/EventsStrategy.js',
      name: 'events',
      selector: 'div.news-item',
    },
    {
      exportName: 'ProjectsStrategy',
      modulePath: '../src/strategies/ProjectsStrategy.js',
      name: 'projects',
      selector: 'div.news-item',
    },
  ])(
    'parses $name cards with image thumbnails',
    async ({ exportName, modulePath, selector }) => {
      const strategyModule = (await import(modulePath)) as Record<
        string,
        new () => {
          getPostData: ($element: Cheerio<Element>) => {
            component: { toJSON: () => unknown };
            id: null | string;
          };
        }
      >;
      const StrategyClass = strategyModule[exportName];

      if (StrategyClass === undefined) {
        throw new Error(`Missing strategy export: ${exportName}`);
      }

      const strategy = new StrategyClass();
      const $element = loadElement(
        `
        <div class="${selector.replace('div.', '')}">
          <a href="/ignored">Ignored</a><a href="/mk/item">Important title</a>
          <div class="col-xs-12 col-sm-8"><div class="field-content">Important content</div></div>
          <img src="https://finki.ukim.mk/image.png?itok=abc" />
        </div>
      `,
        'div',
      );
      const post = strategy.getPostData($element);
      const strings = collectStrings(post.component.toJSON()).join('\n');

      expect(post.id).toBe('https://finki.ukim.mk/mk/item');
      expect(strings).toContain('Important title');
      expect(strings).toContain('https://finki.ukim.mk/mk/item');
      expect(strings).toContain('Important content');
      expect(strings).toContain('https://finki.ukim.mk/image.png');
    },
  );
});

describe('DiplomasStrategy and MastersStrategy', () => {
  it('parses diploma row data and normalizes heading ID whitespace', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { DiplomasStrategy } =
      await import('../src/strategies/DiplomasStrategy.js');
    const strategy = new DiplomasStrategy();
    const rows = [
      '123/2020 - Jane Doe',
      'Mentor Name',
      'Member One',
      'Member Two',
      '',
      '',
      '',
      'Diploma abstract',
    ]
      .map((value) => `<tr><td>Label</td><td>${value}</td></tr>`)
      .join('');
    const $element = loadElement(
      `<div class="panel"><div class="panel-heading"> Diploma \n Topic </div><div class="panel-body"><table>${rows}</table></div></div>`,
      'div.panel',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(post.id).toBe('Diploma Topic');
    expect(strings).toContain('123/2020 - Jane Doe');
    expect(strings).toContain('Diploma Topic');
    expect(strings).toContain('Diploma abstract');
    expect(strings).toContain('Ментор:');
    expect(strings).toContain('Mentor Name');
  });

  it('parses master row data and falls back when content is missing', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { MastersStrategy } =
      await import('../src/strategies/MastersStrategy.js');
    const strategy = new MastersStrategy();
    const rows = [
      '<span>456/2021</span><span>Doe</span><span>John</span>',
      'Mentor Name',
      'President Name',
      'Member Name',
    ]
      .map((value) => `<tr><td>Label</td><td>${value}</td></tr>`)
      .join('');
    const $element = loadElement(
      `<div class="row rounded"><h5 class="p-2 mt-1"> Master \n Topic </h5><table><tbody>${rows}</tbody></table></div>`,
      'div.row',
    );
    const post = strategy.getPostData($element);
    const strings = collectStrings(post.component.toJSON()).join('\n');

    expect(post.id).toBe('Master Topic');
    expect(strings).toContain('456/2021 - Doe John');
    expect(strings).toContain('Master Topic');
    expect(strings).toContain('Нема опис.');
    expect(strings).toContain('Претседател:');
    expect(strings).toContain('President Name');
  });
});
