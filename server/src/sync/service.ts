/**
 * Sync for the development server: the shared @expense/core SyncEngine (backfill, incremental
 * history sync with the 404 fallback, two-phase fetch, checkpointing) bound to the server's
 * store, Gmail client and configuration.
 */
import { SyncEngine, type SyncKind, type SyncSummary } from '@expense/core';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { serverStore } from '../db/storeAdapter.js';
import { gmailClient } from '../gmail/client.js';
import { connectionStatus } from '../gmail/oauth.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { syncLlmProvider } from '../parsing/llm.js';

export type { SyncKind, SyncSummary };

const log = createLogger('sync');

const engine = new SyncEngine({
  store: serverStore,
  gmail: gmailClient,
  rulesPack: () => loadRulesPack(),
  settings: () => ({
    windowDays: config.sync.windowDays,
    maxMessagesPerRun: config.sync.maxMessagesPerRun,
    discoverySweepHours: config.sync.discoverySweepHours,
    defaultCurrency: config.defaultCurrency,
    localeHint: config.localeHint,
  }),
  llm: syncLlmProvider,
  logger: log,
  isConnected: () => connectionStatus().connected,
});

export function isSyncRunning(): boolean {
  return engine.isRunning();
}

export function runSync(kind: SyncKind = 'auto', options: { force?: boolean } = {}): Promise<SyncSummary> {
  return engine.run(kind, options);
}

/** Periodic background sync — the server-side stand-in for BGAppRefreshTask. */
export function startScheduler(): NodeJS.Timeout | null {
  const minutes = config.sync.intervalMinutes;
  if (!minutes || minutes <= 0) return null;
  log.info('background sync scheduler enabled', { intervalMinutes: minutes });
  const timer = setInterval(() => {
    if (!connectionStatus().connected) return;
    runSync('auto').catch((err) => log.warn('scheduled sync failed', { err: String(err) }));
  }, minutes * 60_000);
  timer.unref();
  return timer;
}
