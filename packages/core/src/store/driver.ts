/**
 * The minimal async SQLite surface the store needs. Implemented over expo-sqlite in the app
 * and over node:sqlite in tests, so the store's SQL is exercised against real SQLite in CI.
 */
export type SqlValue = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs `fn` inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
