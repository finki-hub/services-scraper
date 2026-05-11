import SqliteDatabase from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

import { CACHE_PATH } from './constants.js';
import { logger } from './logger.js';

const DB_FILE_NAME = 'scraper-cache.db';
const DB_PATH = join(CACHE_PATH, DB_FILE_NAME);

let db: SqliteDatabase.Database | undefined;

const migrateFromTextFiles = (database: SqliteDatabase.Database): void => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
  if (!existsSync(CACHE_PATH)) {
    return;
  }

  const dbFiles = new Set([
    `${DB_FILE_NAME}-shm`,
    `${DB_FILE_NAME}-wal`,
    DB_FILE_NAME,
  ]);

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
  const files = readdirSync(CACHE_PATH).filter((file) => !dbFiles.has(file));

  if (files.length === 0) {
    return;
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO seen_posts (scraper_id, post_id, first_seen_at, last_seen_at)
    VALUES (?, ?, unixepoch(), unixepoch())
  `);

  const migratedFiles: string[] = [];

  const migrate = database.transaction((fileNames: string[]) => {
    for (const file of fileNames) {
      const scraperId = file;
      const filePath = join(CACHE_PATH, file);

      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is derived from controlled cache directory
        const content = readFileSync(filePath, 'utf8');
        const ids = content.trim().split('\n').filter(Boolean);

        for (const id of ids) {
          insert.run(scraperId, id);
        }

        logger.info(
          `Migrated ${ids.length} cache entries from ${file} to SQLite`,
        );
        migratedFiles.push(filePath);
      } catch {
        // Skip files that can't be read during migration
      }
    }
  });

  migrate(files);

  for (const filePath of migratedFiles) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is derived from controlled cache directory
      unlinkSync(filePath);
    } catch {
      // Ignore cleanup failures
    }
  }
};

const initializeDatabase = (): SqliteDatabase.Database => {
  if (db !== undefined) {
    return db;
  }

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
  if (!existsSync(CACHE_PATH)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CACHE_PATH is a controlled constant
    mkdirSync(CACHE_PATH, { recursive: true });
  }

  db = new SqliteDatabase(DB_PATH);
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

  migrateFromTextFiles(db);

  return db;
};

export const getSeenPostIds = (scraperId: string): Set<string> => {
  const database = initializeDatabase();
  const rows = database
    .prepare('SELECT post_id FROM seen_posts WHERE scraper_id = ?')
    .all(scraperId) as Array<{ post_id: string }>;

  return new Set(rows.map((row) => row.post_id));
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

  const insert = database.prepare(`
    INSERT INTO seen_posts (scraper_id, post_id, first_seen_at, last_seen_at)
    VALUES (?, ?, unixepoch(), unixepoch())
    ON CONFLICT(scraper_id, post_id) DO UPDATE SET
      last_seen_at = unixepoch()
  `);

  const transaction = database.transaction((ids: string[]) => {
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
