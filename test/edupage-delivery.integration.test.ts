/* eslint-disable camelcase -- EduPage wire fixtures use snake_case fields. */
import type * as DiscordExports from 'discord.js';

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Scraper as ScraperInstance } from '../src/Scraper.js';
import type * as CacheExports from '../src/utils/cache.js';

type CacheModule = typeof CacheExports;
type Fixture = {
  cache: CacheModule;
  cachePath: string;
  errorSend: SendMock;
  networkRequests: () => number;
  scenario: MutableScenario;
  scraper: ScraperInstance;
  send: SendMock;
  server: Server;
};

type MutableScenario = {
  defaultNum: string;
  timetableIds: string[];
  updated: boolean;
};

type SendMock = ReturnType<
  typeof vi.fn<(payload: unknown) => Promise<unknown>>
>;

const scraperId = 'edupage-delivery-integration';
const stopLoopMessage = 'stop integration scraper';
const stopLoopRegex = /stop integration scraper/u;
const roleId = '123456789012345678';
const loopbackUrlRegex = /http:\/\/127\.0\.0\.1:\d+/u;

const state: { fixture: Fixture | undefined } = { fixture: undefined };

const makeTables = (updated: boolean) => {
  const cards = Array.from({ length: 225 }, (_, index) => ({
    days: updated ? '0100000' : '1000000',
    durationperiods: updated ? '2' : '1',
    id: `card-${index + 1}`,
    lessonid: `lesson-${index + 1}`,
    period: updated ? 'period-2' : 'period-1',
    weeks: updated ? '2' : '1',
  }));
  const lessons = cards.map((card, index) => ({
    classids: [updated ? 'class-new' : 'class-old'],
    classroomids: [updated ? 'room-new' : 'room-old'],
    id: card.lessonid,
    subjectid: updated ? 'subject-new' : 'subject-old',
    teacherids: [updated ? 'teacher-new' : 'teacher-old'],
    variation: index,
  }));

  return {
    r: {
      dbiAccessorRes: {
        tables: [
          { data_rows: cards, id: 'cards' },
          { data_rows: lessons, id: 'lessons' },
          {
            data_rows: [
              { id: 'class-old', name: 'Group A' },
              { id: 'class-new', name: 'Group B' },
            ],
            id: 'classes',
          },
          {
            data_rows: [
              { id: 'room-old', name: 'Room 1' },
              { id: 'room-new', name: 'Room 2' },
            ],
            id: 'classrooms',
          },
          {
            data_rows: [
              {
                endtime: '09:00',
                id: 'period-1',
                name: '1',
                starttime: '08:00',
              },
              {
                endtime: '10:00',
                id: 'period-2',
                name: '2',
                starttime: '09:00',
              },
            ],
            id: 'periods',
          },
          {
            data_rows: [
              { id: 'subject-old', name: 'Mathematics' },
              { id: 'subject-new', name: 'Advanced Mathematics' },
            ],
            id: 'subjects',
          },
          {
            data_rows: [
              { firstname: 'Ada', id: 'teacher-old', lastname: 'Lovelace' },
              { firstname: 'Grace', id: 'teacher-new', lastname: 'Hopper' },
            ],
            id: 'teachers',
          },
        ],
      },
    },
  };
};

const parseMessageComponents = (payload: unknown): unknown[] => {
  const message = payload as { components?: unknown };
  return Array.isArray(message.components) ? message.components : [];
};

const countComponentTree = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (count, component) => count + countComponentTree(component),
      0,
    );
  }
  if (value === null || typeof value !== 'object') return 0;

  const componentNode = value as {
    accessory?: unknown;
    components?: unknown;
  };
  return (
    1 +
    countComponentTree(componentNode.components) +
    countComponentTree(componentNode.accessory)
  );
};

const expectOneScrapeCycle = async (
  scraper: Fixture['scraper'],
): Promise<void> => {
  await expect(scraper.run()).rejects.toThrow(stopLoopRegex);
};

const createFixture = async (): Promise<Fixture> => {
  const cachePath = await mkdtemp(
    join(tmpdir(), 'edupage-delivery-integration-'),
  );
  let server: Server | undefined;
  let cache: CacheModule | undefined;

  try {
    const scenario: MutableScenario = {
      defaultNum: '28',
      timetableIds: ['28'],
      updated: false,
    };
    let requestCount = 0;
    const send = vi.fn<(payload: unknown) => Promise<unknown>>();
    send.mockResolvedValue(undefined);
    const errorSend = vi.fn<(payload: unknown) => Promise<unknown>>();
    errorSend.mockResolvedValue(undefined);

    const activeServer = createServer((request, response) => {
      requestCount += 1;
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.includes('ttviewer.js')) {
        response.end(
          JSON.stringify({
            r: {
              regular: {
                default_num: scenario.defaultNum,
                timetables: scenario.timetableIds.map((tt_num) => ({
                  name: `Timetable ${tt_num}`,
                  tt_num,
                })),
              },
            },
          }),
        );
        return;
      }
      if (request.url?.includes('regulartt.js')) {
        response.end(JSON.stringify(makeTables(scenario.updated)));
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
    server = activeServer;

    await new Promise<void>((resolve, reject) => {
      activeServer.once('error', reject);
      activeServer.listen(0, '127.0.0.1', resolve);
    });
    const address = activeServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('integration HTTP fixture did not bind a TCP port');
    }
    const link = `http://127.0.0.1:${address.port}`;

    vi.doMock('../src/utils/constants.js', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      CACHE_PATH: cachePath,
    }));
    vi.doMock('../src/utils/logger.js', () => ({
      logger: {
        error: vi.fn<(...args: unknown[]) => void>(),
        info: vi.fn<(...args: unknown[]) => void>(),
      },
    }));
    vi.doMock('../src/configuration/config.js', () => ({
      getConfigProperty: (property: string) =>
        ({
          errorDelay: 0,
          maxPosts: 20,
          scrapers: {
            [scraperId]: {
              link,
              role: roleId,
              strategy: 'edupage',
              webhook: 'https://discord.invalid/webhook',
            },
          },
          sendPosts: true,
          successDelay: 0,
          webhook: '',
        })[property],
    }));
    vi.doMock('../src/utils/webhooks.js', () => ({
      errorWebhook: { send: errorSend },
    }));
    vi.doMock('discord.js', async (importOriginal) => {
      const actual = await importOriginal<typeof DiscordExports>();
      return {
        ...actual,
        WebhookClient: class {
          public send(payload: unknown): Promise<unknown> {
            return send(payload);
          }
        },
      };
    });

    cache = await import('../src/utils/cache.js');
    const { Scraper } = await import('../src/Scraper.js');
    vi.spyOn(Scraper, 'sleep').mockRejectedValue(new Error(stopLoopMessage));

    return {
      cache,
      cachePath,
      errorSend,
      networkRequests: () => requestCount,
      scenario,
      scraper: new Scraper(scraperId),
      send,
      server: activeServer,
    };
  } catch (error) {
    const failedServer = server;
    if (failedServer?.listening) {
      failedServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        failedServer.close(() => {
          resolve();
        });
      });
    }
    cache?.closeCache();
    await rm(cachePath, { force: true, recursive: true });
    throw error;
  }
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('Temporal', {
    Now: { plainDateISO: () => ({ month: 8, year: 2_026 }) },
  });
  vi.stubEnv('POSTHOG_KEY', '');
  vi.stubEnv('POSTHOG_HOST', 'https://analytics.invalid');
  state.fixture = await createFixture();
});

afterEach(async () => {
  const current = state.fixture;
  state.fixture = undefined;
  if (current !== undefined) {
    current.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      current.server.close(() => {
        resolve();
      });
    });
    current.cache.closeCache();
    await rm(current.cachePath, { force: true, recursive: true });
  }
  vi.doUnmock('../src/utils/constants.js');
  vi.doUnmock('../src/utils/logger.js');
  vi.doUnmock('../src/configuration/config.js');
  vi.doUnmock('../src/utils/webhooks.js');
  vi.doUnmock('discord.js');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('baselines silently, retries one 225-card summary, then ignores unchanged cards', async () => {
  const current = state.fixture;
  if (current === undefined) throw new Error('missing integration fixture');

  await expectOneScrapeCycle(current.scraper);
  const baselineListing = current.cache.getSnapshot(scraperId, 'listing');
  const baselineCards = current.cache.getSnapshot(scraperId, 'cards:28');

  expect(baselineListing).toBeDefined();
  expect(baselineCards).toBeDefined();
  expect(current.send).not.toHaveBeenCalled();
  expect(current.networkRequests()).toBe(2);

  current.scenario.updated = true;
  current.send.mockRejectedValueOnce(new Error('webhook message failed'));
  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledOnce();
  expect(current.networkRequests()).toBe(4);
  expect(current.cache.getSnapshot(scraperId, 'listing')).toBe(baselineListing);
  expect(current.cache.getSnapshot(scraperId, 'cards:28')).toBe(baselineCards);
  expect(current.errorSend).toHaveBeenCalledOnce();

  const firstPayload = current.send.mock.calls[0]?.[0];
  const firstComponents = parseMessageComponents(firstPayload);

  expect(countComponentTree(firstComponents)).toBe(2);
  expect(countComponentTree(firstComponents)).toBeLessThanOrEqual(40);
  expect(JSON.stringify(firstComponents)).toContain(`<@&${roleId}>`);
  expect(JSON.stringify(firstComponents)).toContain('Промени во распоредот');
  expect(JSON.stringify(firstComponents)).toMatch(loopbackUrlRegex);

  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledTimes(2);
  expect(current.send.mock.calls[0]).toStrictEqual(current.send.mock.calls[1]);
  expect(current.networkRequests()).toBe(4);
  expect(current.cache.getSnapshot(scraperId, 'cards:28')).not.toBe(
    baselineCards,
  );

  const sentAfterRetry = current.send.mock.calls.length;
  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledTimes(sentAfterRetry);
  expect(current.networkRequests()).toBe(6);
}, 10_000);

test('rolls back a failed SQLite commit, retries commit-only, then reports an unseen active timetable once', async () => {
  const current = state.fixture;
  if (current === undefined) throw new Error('missing integration fixture');

  await expectOneScrapeCycle(current.scraper);
  const baselineListing = current.cache.getSnapshot(scraperId, 'listing');
  const baselineCards = current.cache.getSnapshot(scraperId, 'cards:28');
  current.scenario.updated = true;

  current.cache.closeCache();
  const triggerDbPath = join(current.cachePath, 'scraper-cache.db');
  {
    using triggerDb = new DatabaseSync(triggerDbPath);
    triggerDb.exec(`
      CREATE TRIGGER fail_integration_listing_update
      BEFORE UPDATE ON snapshots
      WHEN OLD.scraper_id = '${scraperId}' AND OLD.key = 'listing'
      BEGIN
        SELECT RAISE(ABORT, 'injected integration commit failure');
      END;
    `);
  }

  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledOnce();
  expect(current.networkRequests()).toBe(4);
  expect(current.cache.getSnapshot(scraperId, 'listing')).toBe(baselineListing);
  expect(current.cache.getSnapshot(scraperId, 'cards:28')).toBe(baselineCards);
  expect(current.errorSend).toHaveBeenCalledOnce();

  current.cache.closeCache();
  {
    using dropTriggerDb = new DatabaseSync(triggerDbPath);
    dropTriggerDb.exec('DROP TRIGGER fail_integration_listing_update');
  }
  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledOnce();
  expect(current.networkRequests()).toBe(4);
  expect(current.cache.getSnapshot(scraperId, 'listing')).toBe(baselineListing);
  expect(current.cache.getSnapshot(scraperId, 'cards:28')).not.toBe(
    baselineCards,
  );

  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledOnce();
  expect(current.networkRequests()).toBe(6);

  current.scenario.defaultNum = '29';
  current.scenario.timetableIds = ['28', '29'];
  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledTimes(2);
  expect(current.networkRequests()).toBe(8);

  const newTimetablePayloads = current.send.mock.calls.slice(1);

  expect(JSON.stringify(newTimetablePayloads)).toContain('EduPage');
  expect(JSON.stringify(newTimetablePayloads)).toContain(
    'Промени во распоредот',
  );
  expect(
    countComponentTree(parseMessageComponents(newTimetablePayloads[0]?.[0])),
  ).toBe(2);

  await expectOneScrapeCycle(current.scraper);

  expect(current.send).toHaveBeenCalledTimes(2);
  expect(current.networkRequests()).toBe(10);
}, 10_000);
