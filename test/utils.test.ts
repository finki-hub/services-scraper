import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema, RequiredConfigSchema } from '../src/lib/Config.js';
import {
  ScraperConfigSchema,
  Strategy,
  StrategySchema,
} from '../src/lib/Scraper.js';
import { truncateString } from '../src/utils/components.js';
import { ERROR_MESSAGES } from '../src/utils/constants.js';

const invalidInputRegex = /Invalid/u;
const schemaErrorRegex = /Invalid|Too small/u;

afterEach(() => {
  vi.doUnmock('../src/configuration/config.js');
  vi.resetModules();
});

describe('truncateString', () => {
  it('returns short strings unchanged', () => {
    expect(truncateString('short', 10)).toBe('short');
  });

  it('truncates long strings and preserves max length', () => {
    expect(truncateString('1234567890', 6)).toBe('123...');
  });
});

describe('configuration schemas', () => {
  const exampleLink = 'https://example.test';

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
        link: exampleLink,
        strategy: 'jobs',
      }),
    ).toStrictEqual({
      link: exampleLink,
      strategy: 'jobs',
    });
    expect(() => ScraperConfigSchema.parse({ link: exampleLink })).toThrow(
      invalidInputRegex,
    );
    expect(() => ScraperConfigSchema.parse({ strategy: 'jobs' })).toThrow(
      invalidInputRegex,
    );
  });

  it('parses accentColor hex strings into integers', () => {
    expect(
      ScraperConfigSchema.parse({
        accentColor: '#2A93D1',
        link: exampleLink,
        strategy: 'diplomas',
      }).accentColor,
    ).toBe(0x2a_93_d1);
  });

  it('rejects malformed accentColor values', () => {
    for (const accentColor of ['2a93d1', '#xyz123', '#2a93d1ff', 'blue']) {
      expect(() =>
        ScraperConfigSchema.parse({
          accentColor,
          link: exampleLink,
          strategy: 'diplomas',
        }),
      ).toThrow(invalidInputRegex);
    }
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
            link: exampleLink,
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

  it('rejects empty credential fields', () => {
    expect(() =>
      RequiredConfigSchema.parse({
        credentials: { password: '', username: '' },
      }),
    ).toThrow(schemaErrorRegex);
  });

  it('rejects non-positive maxPosts and negative delays', () => {
    expect(() => RequiredConfigSchema.parse({ maxPosts: 0 })).toThrow(
      schemaErrorRegex,
    );
    expect(() => RequiredConfigSchema.parse({ maxPosts: -1 })).toThrow(
      schemaErrorRegex,
    );
    expect(() => RequiredConfigSchema.parse({ errorDelay: -1 })).toThrow(
      schemaErrorRegex,
    );
    expect(() => RequiredConfigSchema.parse({ successDelay: -1 })).toThrow(
      schemaErrorRegex,
    );
  });

  it('rejects malformed links and enabled scrapers with unknown strategies', () => {
    expect(() =>
      ScraperConfigSchema.parse({ link: 'not-a-url', strategy: 'jobs' }),
    ).toThrow(schemaErrorRegex);
    expect(() =>
      RequiredConfigSchema.parse({
        scrapers: {
          stale: { enabled: true, link: exampleLink, strategy: 'unknown' },
        },
      }),
    ).toThrow(schemaErrorRegex);
  });

  it('ignores the strategy of disabled scrapers', () => {
    expect(
      RequiredConfigSchema.parse({
        scrapers: {
          stale: { enabled: false, link: exampleLink, strategy: 'unknown' },
        },
      }).scrapers,
    ).toHaveProperty('stale.strategy', 'unknown');
  });

  it('rejects malformed webhook URLs but allows disabled webhooks', () => {
    expect(() => RequiredConfigSchema.parse({ webhook: 'not-a-url' })).toThrow(
      schemaErrorRegex,
    );
    expect(RequiredConfigSchema.parse({ webhook: '' }).webhook).toBe('');
  });

  it('rejects malformed role IDs but allows disabling mentions', () => {
    expect(() =>
      ScraperConfigSchema.parse({
        link: exampleLink,
        role: 'everyone',
        strategy: 'jobs',
      }),
    ).toThrow(schemaErrorRegex);
    expect(
      ScraperConfigSchema.parse({
        link: exampleLink,
        role: '',
        strategy: 'jobs',
      }).role,
    ).toBe('');
  });

  it('parses the shipped sample configuration', () => {
    const sample: unknown = JSON.parse(
      readFileSync('./config/config.sample.json', 'utf8'),
    );

    expect(() => ConfigSchema.parse(sample)).not.toThrow();
  });
});

describe('createStrategy', () => {
  it.each([
    [Strategy.Activities, 'postsSelector', 'li.activity'],
    [Strategy.Announcements, 'collection', 'announcement'],
    [Strategy.Course, 'postsSelector', 'article'],
    [Strategy.Diplomas, 'postsSelector', 'div.panel'],
    [Strategy.Events, 'collection', 'event'],
    [Strategy.Example, 'postsSelector', 'Selector for all data containers'],
    [Strategy.Jobs, 'collection', 'jobs-and-internships'],
    [Strategy.Masters, 'postsSelector', 'div.row.rounded'],
    [
      Strategy.Partners,
      'postsSelector',
      'div.card, div.support, .view-id-prijateli ul > li',
    ],
    [Strategy.Projects, 'collection', 'project'],
    [Strategy.Timetables, 'collection', 'schedule'],
  ])(
    'returns a strategy instance for %s',
    async (strategyName, property, expectedValue) => {
      vi.doMock('../src/configuration/config.js', () => ({
        getConfigProperty: () => {},
      }));

      const { createStrategy } = await import('../src/utils/strategies.js');
      const strategy = createStrategy(strategyName);

      expect(strategy).toHaveProperty(property, expectedValue);
    },
  );

  it.each(['internships', 'missing'])(
    'throws for invalid name %s',
    async (strategyName) => {
      vi.doMock('../src/configuration/config.js', () => ({
        getConfigProperty: () => {},
      }));

      const { createStrategy } = await import('../src/utils/strategies.js');

      expect(() => createStrategy(strategyName)).toThrow(
        ERROR_MESSAGES.strategyNotFound,
      );
    },
  );
});
