import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { z } from 'zod';

import { CACHE_PATH } from './constants.js';
import { logger } from './logger.js';

const DB_FILE_NAME = 'scraper-cache.db';
const DB_PATH = join(CACHE_PATH, DB_FILE_NAME);

const PostIdRowsSchema = z.array(z.tuple([z.string()]));
const SnapshotRowSchema = z.tuple([z.string()]).optional();

let db: DatabaseSync | undefined;
const statements = new Map<string, StatementSync>();

const initializeDatabase = (): DatabaseSync => {
  if (db !== undefined) {
    return db;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
  if (!existsSync(CACHE_PATH)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
    mkdirSync(CACHE_PATH, { recursive: true });
  }

  try {
    db = new DatabaseSync(DB_PATH);
  } catch (error) {
    logger.error(
      { error },
      'Failed to open SQLite cache database. Ensure the cache directory is writable.',
    );
    throw new Error('Failed to open SQLite cache database', { cause: error });
  }

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS seen_posts (
      scraper_id    TEXT    NOT NULL,
      post_id       TEXT    NOT NULL,
      first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (scraper_id, post_id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS snapshots (
      scraper_id  TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (scraper_id, key)
    ) WITHOUT ROWID;
  `);

  return db;
};

const prepareStatement = (
  key: string,
  sql: string,
  returnArrays = false,
): StatementSync => {
  const cached = statements.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const database = initializeDatabase();
  const statement = database.prepare(sql);

  if (returnArrays) {
    statement.setReturnArrays(true);
  }

  statements.set(key, statement);

  return statement;
};

const SEEN_POSTS_SELECT_SQL =
  'SELECT post_id FROM seen_posts WHERE scraper_id = ?';

const SEEN_POSTS_UPSERT_SQL = `
  INSERT INTO seen_posts (scraper_id, post_id, first_seen_at, last_seen_at)
  VALUES (?, ?, unixepoch(), unixepoch())
  ON CONFLICT(scraper_id, post_id) DO UPDATE SET
    last_seen_at = unixepoch()
`;

const SNAPSHOT_SELECT_SQL =
  'SELECT value FROM snapshots WHERE scraper_id = ? AND key = ?';

const SNAPSHOT_UPSERT_SQL = `
  INSERT INTO snapshots (scraper_id, key, value, updated_at)
  VALUES (?, ?, ?, unixepoch())
  ON CONFLICT(scraper_id, key) DO UPDATE SET
    value = excluded.value,
    updated_at = unixepoch()
`;

export const getSeenPostIds = (scraperId: string): Set<string> => {
  const select = prepareStatement(
    'seenPostsSelect',
    SEEN_POSTS_SELECT_SQL,
    true,
  );
  const rows = PostIdRowsSchema.parse(select.all(scraperId));

  return new Set(rows.map(([id]) => id));
};

export const markPostsSeen = (
  scraperId: string,
  postIds: Array<null | string>,
): void => {
  const validIds = postIds.filter((id): id is string => id !== null);

  if (validIds.length === 0) {
    return;
  }

  const database = initializeDatabase();
  const upsert = prepareStatement('seenPostsUpsert', SEEN_POSTS_UPSERT_SQL);

  database.exec('BEGIN');

  try {
    for (const id of validIds) {
      upsert.run(scraperId, id);
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

export const getSnapshot = (
  scraperId: string,
  key: string,
): string | undefined => {
  const select = prepareStatement('snapshotSelect', SNAPSHOT_SELECT_SQL, true);
  const row = SnapshotRowSchema.parse(select.get(scraperId, key));

  return row?.[0];
};

export const setSnapshot = (
  scraperId: string,
  key: string,
  value: string,
): void => {
  const upsert = prepareStatement('snapshotUpsert', SNAPSHOT_UPSERT_SQL);
  upsert.run(scraperId, key, value);
};

export const closeCache = (): void => {
  statements.clear();
  db?.close();
  db = undefined;
};
