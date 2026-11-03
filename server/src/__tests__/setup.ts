/**
 * Guard rail: the suite truncates tables, so it must never be pointed at a real store.
 * Without this, a stray DATABASE_PATH would let `npm test` wipe the developer's data.
 */
import { config } from '../config.js';

if (config.databasePath !== ':memory:') {
  throw new Error(
    `Tests must run against an in-memory database, got "${config.databasePath}". ` +
      'Check DATABASE_PATH and vitest.config.ts.',
  );
}
