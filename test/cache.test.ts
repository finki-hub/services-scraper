import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CacheExports from '../src/utils/cache.js';

type CacheModule = typeof CacheExports;

const state: { cacheModule: CacheModule | undefined; cachePath: string } = {
  cacheModule: undefined,
  cachePath: '',
};

const importCache = async (): Promise<CacheModule> => {
  vi.doMock('../src/utils/constants.js', () => ({
    CACHE_PATH: state.cachePath,
  }));
  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      error: vi.fn<(...args: unknown[]) => void>(),
      info: vi.fn<(...args: unknown[]) => void>(),
    },
  }));

  const loaded = await import('../src/utils/cache.js');

  state.cacheModule = loaded;

  return loaded;
};

const loadCache = async (): Promise<CacheModule> => {
  state.cachePath = await mkdtemp(
    join(tmpdir(), 'services-scraper-cache-test-'),
  );

  return importCache();
};

beforeEach(() => {
  state.cacheModule = undefined;
  state.cachePath = '';
  vi.resetModules();
});

afterEach(async () => {
  state.cacheModule?.closeCache();
  vi.doUnmock('../src/utils/constants.js');
  vi.doUnmock('../src/utils/logger.js');
  vi.resetModules();

  if (state.cachePath !== '') {
    await rm(state.cachePath, { force: true, recursive: true });
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

  it('returns the latest legacy timestamp without WordPress IDs', async () => {
    const cache = await loadCache();
    cache.markPostsSeen('announcements', ['legacy-older', 'legacy-newer']);
    cache.markPostsSeen('announcements', ['wordpress:announcement:42']);
    cache.markPostsSeen('wordpress-only', ['wordpress:announcement:43']);
    const database = new DatabaseSync(
      join(state.cachePath, 'scraper-cache.db'),
    );
    const updateTimestamp = database.prepare(`
      UPDATE seen_posts
      SET last_seen_at = ?
      WHERE scraper_id = ? AND post_id = ?
    `);
    updateTimestamp.run(100, 'announcements', 'legacy-older');
    updateTimestamp.run(200, 'announcements', 'legacy-newer');
    updateTimestamp.run(300, 'announcements', 'wordpress:announcement:42');
    database.close();

    expect(cache.getLatestLegacySeenAt('announcements')).toBe(200);
    expect(cache.getLatestLegacySeenAt('wordpress-only')).toBeUndefined();
  });

  it('persists IDs after closing and reopening the cache module', async () => {
    const cache = await loadCache();

    cache.markPostsSeen('announcements', ['post-1']);
    cache.closeCache();
    state.cacheModule = undefined;
    vi.resetModules();

    const reopenedCache = await importCache();

    expect(reopenedCache.getSeenPostIds('announcements')).toStrictEqual(
      new Set(['post-1']),
    );
  });
});

describe('JSON snapshot cache', () => {
  it('returns undefined for a missing snapshot', async () => {
    const cache = await loadCache();

    expect(cache.getSnapshot('edupage', 'listing')).toBeUndefined();
  });

  it('stores and retrieves a snapshot', async () => {
    const cache = await loadCache();
    const data = JSON.stringify({ defaultNum: '28', ttNums: ['25', '28'] });

    cache.setSnapshot('edupage', 'listing', data);

    expect(cache.getSnapshot('edupage', 'listing')).toBe(data);
  });

  it('overwrites an existing snapshot', async () => {
    const cache = await loadCache();

    cache.setSnapshot('edupage', 'listing', '{"v":1}');
    cache.setSnapshot('edupage', 'listing', '{"v":2}');

    expect(cache.getSnapshot('edupage', 'listing')).toBe('{"v":2}');
  });

  it('keeps scraper and key namespaces separate', async () => {
    const cache = await loadCache();

    cache.setSnapshot('edupage', 'listing', 'edupage-listing');
    cache.setSnapshot('edupage', 'cards:28', 'edupage-cards');
    cache.setSnapshot('other', 'listing', 'other-listing');

    expect(cache.getSnapshot('edupage', 'listing')).toBe('edupage-listing');
    expect(cache.getSnapshot('edupage', 'cards:28')).toBe('edupage-cards');
    expect(cache.getSnapshot('other', 'listing')).toBe('other-listing');
    expect(cache.getSnapshot('edupage', 'missing')).toBeUndefined();
  });

  it('persists snapshots after closing and reopening', async () => {
    const cache = await loadCache();

    cache.setSnapshot('edupage', 'listing', '{"persisted":true}');
    cache.closeCache();
    state.cacheModule = undefined;
    vi.resetModules();

    const reopenedCache = await importCache();

    expect(reopenedCache.getSnapshot('edupage', 'listing')).toBe(
      '{"persisted":true}',
    );
  });
});
