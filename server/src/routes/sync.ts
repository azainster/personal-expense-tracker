import { Router } from 'express';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { connectionStatus } from '../gmail/oauth.js';
import { isSyncRunning, runSync, type SyncKind } from '../sync/service.js';
import { loadRulesPack, PARSER_VERSION } from '../parsing/rulespack.js';
import { isLlmAvailable } from '../parsing/llm.js';
import { seedSampleData } from '../seed/run.js';
import { asyncHandler } from './helpers.js';
import { ValidationError } from '../errors.js';

export const syncRouter = Router();

const VALID_KINDS: SyncKind[] = ['auto', 'backfill', 'incremental', 'discovery'];

syncRouter.get('/status', (_req, res) => {
  const connection = connectionStatus();
  const state = connection.accountEmail ? repo.getSyncState(connection.accountEmail) : null;
  res.json({
    running: isSyncRunning(),
    connection,
    state,
    latestRun: repo.latestSyncRun(),
    recentRuns: repo.listSyncRuns(5),
    rulesPackVersion: loadRulesPack().version,
    parserVersion: PARSER_VERSION,
    remoteLlmEnabled: isLlmAvailable(),
    windowDays: config.sync.windowDays,
    schedulerMinutes: config.sync.intervalMinutes,
  });
});

syncRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = (body.kind as SyncKind) ?? 'auto';
    if (!VALID_KINDS.includes(kind)) {
      throw new ValidationError(`kind must be one of ${VALID_KINDS.join(', ')}`);
    }
    const summary = await runSync(kind, { force: body.force === true });
    res.json({ summary });
  }),
);

/** Seeds (or re-seeds) the bundled sample corpus — the demo mode the spec asks for. */
syncRouter.post(
  '/sample-data',
  asyncHandler(async (req, res) => {
    const reset = (req.body as Record<string, unknown> | undefined)?.reset === true;
    const stats = await seedSampleData({ reset });
    res.json({ seeded: stats });
  }),
);

syncRouter.delete('/sample-data', (_req, res) => {
  const removed = repo.deleteBySource('sample');
  res.json({ removed });
});

syncRouter.get('/failures', (_req, res) => {
  res.json({ failures: repo.parseFailureSummary(), discoveredSenders: repo.listDiscoveredSenders() });
});
