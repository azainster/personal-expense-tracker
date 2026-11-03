import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { runMigrations } from './migrations.js';

const log = createLogger('db');

let handle: DatabaseSync | null = null;

/** Opens (and on first call, migrates) the SQLite database. */
export function getDb(): DatabaseSync {
  if (handle) return handle;
  const path = config.databasePath;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  if (path !== ':memory:') {
    // Server-side analogue of the spec's FileProtection requirement: the store holds
    // financial history and an encrypted refresh token, so keep it owner-only.
    try {
      chmodSync(path, 0o600);
    } catch (err) {
      log.warn('could not restrict database file permissions', { err: String(err) });
    }
  }

  runMigrations(db);
  handle = db;
  log.info('database ready', { path });
  return db;
}

export function closeDb(): void {
  if (handle) {
    handle.close();
    handle = null;
  }
}

/** Runs `fn` inside a transaction, rolling back on throw. */
export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* rollback of an already-closed transaction is not interesting */
    }
    throw err;
  }
}

/** Test/CLI helper: drop every row while keeping the schema. */
export function truncateAll(): void {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'")
    .all() as Array<{ name: string }>;
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) db.exec(`DELETE FROM ${t.name}`);
  db.exec('PRAGMA foreign_keys = ON');
}
