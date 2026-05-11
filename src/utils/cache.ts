import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { CACHE_PATH } from './constants.js';
import { logger } from './logger.js';

const DB_FILE_NAME = 'scraper-cache.db';
const DB_PATH = join(CACHE_PATH, DB_FILE_NAME);

let db: DatabaseSync | undefined;
let selectStatement: StatementSync | undefined;
let insertStatement: StatementSync | undefined;

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
  `);

  return db;
};

const getSelectStatement = (): StatementSync => {
  if (selectStatement !== undefined) {
    return selectStatement;
  }

  const database = initializeDatabase();
  selectStatement = database.prepare(
    'SELECT post_id FROM seen_posts WHERE scraper_id = ?',
  );
  selectStatement.setReturnArrays(true);

  return selectStatement;
};

const getInsertStatement = (): StatementSync => {
  if (insertStatement !== undefined) {
    return insertStatement;
  }

  const database = initializeDatabase();
  insertStatement = database.prepare(`
    INSERT INTO seen_posts (scraper_id, post_id, first_seen_at, last_seen_at)
    VALUES (?, ?, unixepoch(), unixepoch())
    ON CONFLICT(scraper_id, post_id) DO UPDATE SET
      last_seen_at = unixepoch()
  `);

  return insertStatement;
};

export const getSeenPostIds = (scraperId: string): Set<string> => {
  const select = getSelectStatement();
  const rows = select.all(scraperId) as unknown as string[][];
  const ids = new Set<string>();

  for (const row of rows) {
    const id = row[0];

    if (typeof id === 'string') {
      ids.add(id);
    }
  }

  return ids;
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
  const insert = getInsertStatement();

  database.exec('BEGIN');

  try {
    for (const id of validIds) {
      insert.run(scraperId, id);
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
};

export const closeCache = (): void => {
  selectStatement = undefined;
  insertStatement = undefined;
  db?.close();
  db = undefined;
};
