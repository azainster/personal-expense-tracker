/** Test-only helpers: load the bundled rules pack from disk, and a node:sqlite store driver. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseRulesPack, type RulesPack } from '../parsing/rulespack.js';
import type { SqlDriver, SqlValue } from '../store/driver.js';
import { SqlStore } from '../store/sqlStore.js';

export const RULES_PACK_PATH = fileURLToPath(new URL('../../rules/rules-pack.json', import.meta.url));

let cached: RulesPack | null = null;
export function loadRulesPack(): RulesPack {
  if (!cached) cached = parseRulesPack(JSON.parse(readFileSync(RULES_PACK_PATH, 'utf8')));
  return cached;
}

export function nodeSqliteDriver(path = ':memory:'): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: SqlValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async transaction<T>(fn: () => Promise<T>) {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      db.close();
    },
  };
}

export async function freshStore(utcOffsetMinutes = 0): Promise<SqlStore> {
  const store = new SqlStore(nodeSqliteDriver(), { newId: randomUUID, utcOffsetMinutes });
  await store.migrate();
  const pack = loadRulesPack();
  await store.seedCategories(pack.categories);
  await store.seedMerchantRules(pack);
  return store;
}

export const TEST_SETTINGS = {
  windowDays: 35,
  maxMessagesPerRun: 400,
  discoverySweepHours: 168,
  defaultCurrency: 'INR',
  localeHint: 'en-IN',
};
