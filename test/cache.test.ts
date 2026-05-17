import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CacheExports from '../src/utils/cache.js';

type CacheModule = typeof CacheExports;

let cachePath: string;
let cacheModule: CacheModule | undefined;

const importCache = async (): Promise<CacheModule> => {
  vi.doMock('../src/utils/constants.js', () => ({
    CACHE_PATH: cachePath,
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));

  cacheModule = await import('../src/utils/cache.js');

  return cacheModule;
};

const loadCache = async (): Promise<CacheModule> => {
  cachePath = await mkdtemp(join(tmpdir(), 'services-scraper-cache-test-'));

  return importCache();
};

beforeEach(() => {
  cacheModule = undefined;
  cachePath = '';
  vi.resetModules();
});

afterEach(async () => {
  cacheModule?.closeCache();
  vi.doUnmock('../src/utils/constants.js');
  vi.doUnmock('../src/utils/logger.js');
  vi.resetModules();

  if (cachePath !== '') {
    await rm(cachePath, { force: true, recursive: true });
  }
});

describe('SQLite seen-post cache', () => {
  it('starts empty for an unseen scraper', async () => {
    const cache = await loadCache();

    expect(cache.getSeenPostIds('announcements')).toStrictEqual(new Set());
  });

  it('marks valid post IDs and ignores null IDs', async () => {
    const cache = await loadCache();

    cache.markPostsSeen('announcements', ['post-1', null, 'post-2']);

    expect(cache.getSeenPostIds('announcements')).toStrictEqual(
      new Set(['post-1', 'post-2']),
    );
  });

  it('upserts duplicate IDs without creating duplicate seen entries', async () => {
    const cache = await loadCache();

    cache.markPostsSeen('announcements', ['post-1', 'post-1']);
    cache.markPostsSeen('announcements', ['post-1']);

    expect([...cache.getSeenPostIds('announcements')]).toStrictEqual([
      'post-1',
    ]);
  });

  it('keeps scraper namespaces separate', async () => {
    const cache = await loadCache();

    cache.markPostsSeen('announcements', ['shared-id']);

    expect(cache.getSeenPostIds('announcements')).toStrictEqual(
      new Set(['shared-id']),
    );
    expect(cache.getSeenPostIds('events')).toStrictEqual(new Set());
  });

  it('persists IDs after closing and reopening the cache module', async () => {
    const cache = await loadCache();

    cache.markPostsSeen('announcements', ['post-1']);
    cache.closeCache();
    cacheModule = undefined;
    vi.resetModules();

    const reopenedCache = await importCache();

    expect(reopenedCache.getSeenPostIds('announcements')).toStrictEqual(
      new Set(['post-1']),
    );
  });
});
