/**
 * Seeds the bundled fixture corpus through the real parsing pipeline.
 *
 * `npm run seed` — lets the dashboard be exercised end to end before Gmail is connected,
 * and gives App-Review-style demo data that is genuinely parser output, not hand-written rows.
 */
import { closeDb, getDb } from '../db/index.js';
import * as repo from '../db/repo.js';
import { createLogger } from '../logger.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { allFixtureEmails } from '@expense/core';
import { ingestMessages } from '../sync/ingest.js';

const log = createLogger('seed');

export async function seedSampleData(options: { reset?: boolean } = {}): Promise<{
  created: number;
  duplicates: number;
  rejected: number;
  skipped: number;
}> {
  getDb();
  const pack = loadRulesPack();
  repo.seedCategories(pack.categories);
  const merchantCount = repo.seedMerchantRules(pack);

  if (options.reset) {
    const removed = repo.deleteBySource('sample');
    log.info('removed existing sample transactions', { removed });
  }

  const stats = await ingestMessages(allFixtureEmails(), { force: options.reset === true });
  log.info('sample data seeded', { ...stats, merchantRules: merchantCount });
  return { created: stats.created, duplicates: stats.duplicates, rejected: stats.failed, skipped: stats.skipped };
}

const isDirectRun = process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js');
if (isDirectRun) {
  seedSampleData({ reset: process.argv.includes('--reset') })
    .then((stats) => {
      process.stdout.write(
        `\nSeeded sample data: ${stats.created} transactions, ${stats.duplicates} duplicates merged, ${stats.rejected} non-transactions rejected.\n`,
      );
      closeDb();
    })
    .catch((err) => {
      process.stderr.write(`Seeding failed: ${String(err)}\n`);
      process.exitCode = 1;
    });
}
