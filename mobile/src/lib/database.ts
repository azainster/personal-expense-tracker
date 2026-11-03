/**
 * expo-sqlite adapter for the shared `SqlDriver` contract.
 *
 * The store file lives in the app's sandbox and inherits the Data Protection class set by the
 * `com.apple.developer.default-data-protection` entitlement (NSFileProtectionCompleteUnlessOpen).
 * Email bodies are never written here — only extracted transactions and provenance.
 */
import * as SQLite from 'expo-sqlite';
import type { SqlDriver, SqlValue } from '@expense/core';

export const DATABASE_NAME = 'expenses.db';

export async function openDriver(): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  // SQLite has one transaction per connection. Queue callers (e.g. Undo tapped while a
  // recategorize is still saving) instead of failing with "cannot start a transaction
  // within a transaction".
  let transactionQueue: Promise<unknown> = Promise.resolve();

  const driver: SqlDriver = {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.getAllAsync<T>(sql, params);
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return db.getFirstAsync<T>(sql, params);
    },
    transaction<T>(fn: () => Promise<T>) {
      const run = transactionQueue.then(async () => {
        let result: T | undefined;
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
        return result as T;
      });
      transactionQueue = run.catch(() => undefined);
      return run;
    },
  };
  return driver;
}
