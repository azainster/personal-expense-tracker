/** `npm run reset` — wipes the local store and re-seeds sample data. */
import { closeDb, getDb, truncateAll } from '../db/index.js';
import { createLogger } from '../logger.js';
import { seedSampleData } from './run.js';

const log = createLogger('reset');

getDb();
truncateAll();
log.info('all local data cleared');

seedSampleData({ reset: true })
  .then((stats) => {
    process.stdout.write(`\nReset complete. Seeded ${stats.created} sample transactions.\n`);
    closeDb();
  })
  .catch((err) => {
    process.stderr.write(`Reset failed: ${String(err)}\n`);
    process.exitCode = 1;
  });
