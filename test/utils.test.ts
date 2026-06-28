import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema, RequiredConfigSchema } from '../src/lib/Config.js';
import {
  ScraperConfigSchema,
  Strategy,
  StrategySchema,
} from '../src/lib/Scraper.js';
import { truncateHeading, truncateString } from '../src/utils/components.js';
import { ERROR_MESSAGES } from '../src/utils/constants.js';
import { getCookieHeader } from '../src/utils/cookies.js';
import { extractErrorCauses } from '../src/utils/error-causes.js';
import { normalizeURL } from '../src/utils/links.js';

const invalidInputRegex = /Invalid/u;

afterEach(() => {
  vi.doUnmock('../src/configuration/config.js');
  vi.resetModules();
});

describe('normalizeURL', () => {
  it('returns absolute URLs unchanged', () => {
    expect(
      normalizeURL('https://example.test/file.pdf', 'https://base.test'),
    ).toBe('https://example.test/file.pdf');
  });

  it('resolves root-relative URLs against the base origin', () => {
    expect(
      normalizeURL('/mk/student-announcement', 'https://finki.ukim.mk'),
    ).toBe('https://finki.ukim.mk/mk/student-announcement');
  });

  it('resolves relative URLs against the base parent path', () => {
    expect(
      normalizeURL(
        'raspored.pdf',
        'https://finki.ukim.mk/mk/student-announcement',
      ),
    ).toBe('https://finki.ukim.mk/mk/raspored.pdf');
  });
});

describe('truncateString', () => {
  it('returns short strings unchanged', () => {
    expect(truncateString('short', 10)).toBe('short');
  });

  it('truncates long strings and preserves max length', () => {
    expect(truncateString('1234567890', 6)).toBe('123...');
  });
});

describe('truncateHeading', () => {
  it('uses the Discord heading length limit by default', () => {
    const heading = 'a'.repeat(300);

    expect(truncateHeading(heading)).toHaveLength(256);
    expect(truncateHeading(heading).slice(-3)).toBe('...');
  });
});

describe('getCookieHeader', () => {
  it('joins cookies with semicolon separators', () => {
    expect(
      getCookieHeader({
        MoodleSession: 'abc',
        SRVNAME: 'node1',
      }),
    ).toBe('MoodleSession=abc; SRVNAME=node1');
  });

  it('returns an empty header for no cookies', () => {
    expect(getCookieHeader({})).toBe('');
  });
});

describe('extractErrorCauses', () => {
  it('flattens nested Error causes in order', () => {
    const root = new Error('root');
    const middle = new Error('middle', { cause: root });
    const top = new Error('top', { cause: middle });

    expect(extractErrorCauses(top)).toStrictEqual(['middle', 'root']);
  });

  it('includes non-Error causes and stops', () => {
    expect(
      extractErrorCauses(new Error('top', { cause: 'plain cause' })),
    ).toStrictEqual(['plain cause']);
  });

  it('stops on self-referential causes', () => {
    const error = new Error('loop');
    // eslint-disable-next-line unicorn/no-error-property-assignment -- a self-referential cause cannot be set at construction time
    error.cause = error;

    expect(extractErrorCauses(error)).toStrictEqual([]);
  });
});

describe('configuration schemas', () => {
  it('strategy schema accepts every known strategy value', () => {
    for (const strategy of Object.values(Strategy)) {
      expect(StrategySchema.parse(strategy)).toBe(strategy);
    }
  });

  it('strategy schema rejects unknown strategy values', () => {
    expect(() => StrategySchema.parse('unknown')).toThrow(invalidInputRegex);
  });

  it('scraper config schema requires link and strategy', () => {
    expect(
      ScraperConfigSchema.parse({
        link: 'https://example.test',
        strategy: 'jobs',
      }),
    ).toStrictEqual({
      link: 'https://example.test',
      strategy: 'jobs',
    });
    expect(() =>
      ScraperConfigSchema.parse({ link: 'https://example.test' }),
    ).toThrow(invalidInputRegex);
    expect(() => ScraperConfigSchema.parse({ strategy: 'jobs' })).toThrow(
      invalidInputRegex,
    );
  });

  it('accepts minimal undefined config for defaults fallback', () => {
    const missingConfig: unknown = undefined;

    expect(ConfigSchema.parse(missingConfig)).toBeUndefined();
  });

  it('accepts a scraper map with optional metadata', () => {
    expect(
      RequiredConfigSchema.parse({
        scrapers: {
          announcements: {
            enabled: true,
            link: 'https://example.test',
            name: 'Announcements',
            strategy: 'announcements',
          },
        },
      }),
    ).toMatchObject({
      scrapers: {
        announcements: {
          enabled: true,
          strategy: 'announcements',
        },
      },
    });
  });

  it('rejects malformed credentials', () => {
    expect(() =>
      RequiredConfigSchema.parse({
        credentials: {
          username: 'student',
        },
      }),
    ).toThrow(invalidInputRegex);
  });
});

describe('createStrategy', () => {
  it.each([
    [Strategy.Activities, 'li.activity'],
    [Strategy.Announcements, 'div.views-row'],
    [Strategy.Course, 'article'],
    [Strategy.Diplomas, 'div.panel'],
    [Strategy.Events, 'div.news-item'],
    [Strategy.Example, 'Selector for all data containers'],
    [Strategy.Internships, 'div.container div.row > div.col > div.card'],
    [Strategy.Jobs, 'div.views-row'],
    [Strategy.Masters, 'div.row.rounded'],
    [Strategy.Partners, 'div.card, div.support'],
    [Strategy.Projects, 'div.news-item'],
    [Strategy.Timetables, 'div.col-sm-11'],
  ])(
    'returns a strategy instance for %s',
    async (strategyName, postsSelector) => {
      vi.doMock('../src/configuration/config.js', () => ({
        getConfigProperty: () => {},
      }));

      const { createStrategy } = await import('../src/utils/strategies.js');
      const strategy = createStrategy(strategyName);

      expect(strategy).toHaveProperty('postsSelector', postsSelector);
    },
  );

  it('throws for invalid names', async () => {
    vi.doMock('../src/configuration/config.js', () => ({
      getConfigProperty: () => {},
    }));

    const { createStrategy } = await import('../src/utils/strategies.js');

    expect(() => createStrategy('missing')).toThrow(
      ERROR_MESSAGES.strategyNotFound,
    );
  });
});
