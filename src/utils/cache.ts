import SqliteDatabase from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE_PATH } from './constants.js';
import { logger } from './logger.js';

const DB_FILE_NAME = 'scraper-cache.db';
const DB_PATH = join(CACHE_PATH, DB_FILE_NAME);

let db: SqliteDatabase.Database | undefined;

const initializeDatabase = (): SqliteDatabase.Database => {
  if (db !== undefined) {
    return db;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
  if (!existsSync(CACHE_PATH)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
    mkdirSync(CACHE_PATH, { recursive: true });
  }

  try {
    db = new SqliteDatabase(DB_PATH);
  } catch (error) {
    logger.error(
      { error },
      'Failed to open SQLite cache database. Ensure the cache directory is writable.',
    );
    throw new Error('Failed to open SQLite cache database', { cause: error });
  }

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_posts (
      scraper_id    TEXT    NOT NULL,
      post_id       TEXT    NOT NULL,
      first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (scraper_id, post_id)
    ) WITHOUT ROWID;
  `);

  return db;
};

const getSelectStatement = (): SqliteDatabase.Statement => {
  const database = initializeDatabase();

  return database
    .prepare('SELECT post_id FROM seen_posts WHERE scraper_id = ?')
    .pluck();
};

const getInsertStatement = (): SqliteDatabase.Statement => {
  const database = initializeDatabase();

  return database.prepare(`
    INSERT INTO seen_posts (scraper_id, post_id, first_seen_at, last_seen_at)
    VALUES (?, ?, unixepoch(), unixepoch())
    ON CONFLICT(scraper_id, post_id) DO UPDATE SET
      last_seen_at = unixepoch()
  `);
};

export const getSeenPostIds = (scraperId: string): Set<string> => {
  const select = getSelectStatement();
  const rows = select.all(scraperId) as string[];

  return new Set(rows);
};

export const markPostsSeen = (
  scraperId: string,
  postIds: Array<null | string>,
): void => {
  const validIds = postIds.filter((id): id is string => id !== null);

  if (validIds.length === 0) {
    return;
  }

  const insert = getInsertStatement();

  const transaction = initializeDatabase().transaction((ids: string[]) => {
    for (const id of ids) {
      insert.run(scraperId, id);
    }
  });

  transaction(validIds);
};

export const closeCache = (): void => {
  db?.close();
  db = undefined;
};
