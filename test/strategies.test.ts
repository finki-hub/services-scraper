import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

import * as cheerio from 'cheerio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import sampleConfig from '../config/config.sample.json' with { type: 'json' };

const configModulePath = '../src/configuration/config.js';
const cacheModulePath = '../src/utils/cache.js';

const cacheMocks = {
  getSeenPostIds: vi.fn<(scraperId: string) => Set<string>>(),
  markPostsSeen:
    vi.fn<(scraperId: string, postIds: Array<null | string>) => void>(),
};

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
  vi.doUnmock(cacheModulePath);
  vi.unstubAllGlobals();
  cacheMocks.getSeenPostIds.mockReset();
  cacheMocks.markPostsSeen.mockReset();
  vi.resetModules();
});

describe('PartnersStrategy', () => {
  it('processes all collaborators after historical entries within the sample cap', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const historicalIds = [
      'Historical support',
      ...Array.from(
        { length: 106 },
        (_, index) => `Historical card ${index + 1}`,
      ),
    ];
    const collaboratorNames = [
      'Digit Software',
      'NextHop',
      'Ход Бпо Солутионс',
      ...Array.from({ length: 13 }, (_, index) => `Collaborator ${index + 4}`),
    ];
    const historicalEntries = [
      '<div class="support">Historical support</div>',
      ...historicalIds.slice(1).map((id) => `<div class="card">${id}</div>`),
    ].join('');
    const collaboratorEntries = [
      '<li style="margin-bottom:8px"><a href="http&#58;//digitsoftware.mk">Digit Software</a></li>',
      '<li style="margin-bottom:8px"><a href="http&#58;//nexthop.mk">NextHop</a></li>',
      '<li style="margin-bottom:8px"><span>Ход Бпо Солутионс</span></li>',
      ...collaboratorNames
        .slice(3)
        .map(
          (name) => `<li style="margin-bottom:8px"><span>${name}</span></li>`,
        ),
    ].join('');
    const html = `
      ${historicalEntries}
      <div class="view view-prijateli view-id-prijateli view-display-id-page">
        <h3>Industry Collaborators</h3>
        <div class="view-content"><ul>${collaboratorEntries}</ul></div>
      </div>
    `;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.doMock(cacheModulePath, () => cacheMocks);
    cacheMocks.getSeenPostIds.mockReturnValue(new Set(historicalIds));

    const { PartnersStrategy } =
      await import('../src/strategies/PartnersStrategy.js');
    const strategy = new PartnersStrategy();
    const result = await strategy.getChanges({
      cookie: undefined,
      link: 'https://partneri.finki.ukim.mk/partners',
      maxPosts: sampleConfig.scrapers.partners.maxPosts,
      scraperId: 'partners-test',
    });

    expect(sampleConfig.scrapers.partners.maxPosts).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheMocks.getSeenPostIds).toHaveBeenCalledWith('partners-test');
    expect(result.itemsFound).toBe(123);
    expect(result.posts).toHaveLength(16);
    expect(new Set(result.posts.map(({ id }) => id))).toStrictEqual(
      new Set(collaboratorNames),
    );

    const postStrings = result.posts
      .flatMap(({ component }) => collectStrings(component.toJSON()))
      .join('\n');

    expect(postStrings).toContain('digitsoftware.mk');
    expect(postStrings).toContain('Ход Бпо Солутионс');
    expect(cacheMocks.markPostsSeen).not.toHaveBeenCalled();

    result.commit();

    expect(cacheMocks.markPostsSeen).toHaveBeenCalledExactlyOnceWith(
      'partners-test',
      [...historicalIds, ...collaboratorNames],
    );
  });

  it('selects linked and text-only partners from the collaborators view', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { PartnersStrategy } =
      await import('../src/strategies/PartnersStrategy.js');
    const strategy = new PartnersStrategy();
    const $ = cheerio.load(`
      <div class="view view-prijateli view-id-prijateli view-display-id-page">
        <h3>Industry Collaborators</h3>
        <div class="view-content">
          <ul>
            <li style="margin-bottom:8px"><a href="http&#58;//digitsoftware.mk">Digit Software</a></li>
            <li style="margin-bottom:8px"><a href="http&#58;//nexthop.mk">NextHop</a></li>
            <li style="margin-bottom:8px"><span>Ход Бпо Солутионс</span></li>
          </ul>
        </div>
      </div>
      <div class="unrelated-list"><ul><li>Unrelated item</li></ul></div>
    `);
    const $partners = $(strategy.postsSelector);

    expect($partners).toHaveLength(3);
    expect(
      $partners.map((_, element) => $(element).text().trim()).toArray(),
    ).toStrictEqual(['Digit Software', 'NextHop', 'Ход Бпо Солутионс']);

    const linkedPartner = $partners.eq(0) as Cheerio<Element>;
    const textOnlyPartner = $partners.eq(2) as Cheerio<Element>;
    const linkedPost = strategy.getPostData(linkedPartner);
    const textOnlyPost = strategy.getPostData(textOnlyPartner);

    expect(strategy.getId(linkedPartner)).toBe('Digit Software');
    expect(strategy.getId(textOnlyPartner)).toBe('Ход Бпо Солутионс');
    expect(linkedPost.id).toBe('Digit Software');
    expect(linkedPartner.find('a').attr('href')).toBeDefined();
    expect(collectStrings(linkedPost.component.toJSON()).join('\n')).toContain(
      'digitsoftware.mk',
    );
    expect(
      collectStrings(textOnlyPost.component.toJSON()).join('\n'),
    ).not.toContain('http://');
    expect($(strategy.postsSelector).text()).not.toContain(
      'Industry Collaborators',
    );
    expect($(strategy.postsSelector).text()).not.toContain('Unrelated item');
  });

  it('cleans partner labels and whitespace from text-only partner IDs', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { PartnersStrategy } =
      await import('../src/strategies/PartnersStrategy.js');
    const strategy = new PartnersStrategy();

    const $element = loadElement(
      '<div class="card"> Gold partner \n\t Example   Company </div>',
      'div',
    );

    expect(strategy.getId($element)).toBe('Example Company');
  });

  it('normalizes A1 partner links to a stable ID and display name', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { PartnersStrategy } =
      await import('../src/strategies/PartnersStrategy.js');
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
});

describe('TimetablesStrategy', () => {
  it('uses the WordPress schedule collection without content previews', async () => {
    vi.doMock(configModulePath, () => ({
      getConfigProperty: () => {},
    }));

    const { TimetablesStrategy } =
      await import('../src/strategies/TimetablesStrategy.js');
    const strategy = new TimetablesStrategy();

    expect(strategy.collection).toBe('schedule');
    // eslint-disable-next-line vitest/prefer-to-be-falsy -- assert the exact public option value
    expect(strategy.includeContent).toBe(false);
  });
});

describe('WordPress content strategies', () => {
  it.each([
    {
      collection: 'jobs-and-internships',
      exportName: 'JobsStrategy',
      modulePath: '../src/strategies/JobsStrategy.js',
      name: 'jobs',
    },
    {
      collection: 'event',
      exportName: 'EventsStrategy',
      modulePath: '../src/strategies/EventsStrategy.js',
      name: 'events',
    },
    {
      collection: 'project',
      exportName: 'ProjectsStrategy',
      modulePath: '../src/strategies/ProjectsStrategy.js',
      name: 'projects',
    },
  ])(
    'maps $name to its WordPress collection and legacy selector',
    async ({ collection, exportName, modulePath }) => {
      vi.doMock(configModulePath, () => ({
        getConfigProperty: () => {},
      }));

      const strategyModule = (await import(modulePath)) as Record<
        string,
        new () => {
          collection: string;
        }
      >;
      const StrategyClass = strategyModule[exportName];

      if (StrategyClass === undefined) {
        throw new Error(`Missing strategy export: ${exportName}`);
      }

      const strategy = new StrategyClass();

      expect(strategy.collection).toBe(collection);
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
