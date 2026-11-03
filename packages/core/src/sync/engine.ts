/**
 * Sync loop (§2.2, §2.3, §7 Step 7).
 *
 *  - initial backfill over the Tier-1 allowlist plus a Tier-2 discovery sweep;
 *  - incremental sync via history.list, with the mandatory 404 → full re-sync fallback;
 *  - two-phase fetch: metadata triage first, full bodies only for survivors;
 *  - checkpointed after every batch (triaged ids are recorded), so an interrupted run —
 *    a background task out of time, the app killed — resumes instead of restarting;
 *  - an optional deadline for background refresh, which gets ~30 seconds (§6).
 */
import { HistoryExpiredError, ReauthRequiredError } from '../errors.js';
import { noopLogger, type Logger } from '../logger.js';
import type { LlmProvider } from '../llm/contract.js';
import type { GmailApi } from '../gmail/client.js';
import { extractBodies, headerValue, parseAddress, parseInternalDate, type GmailMessage } from '../gmail/mime.js';
import { subjectSurvivesTriage, tier1Queries, tier2Query } from '../gmail/queries.js';
import { matchSender, PARSER_VERSION, type RulesPack } from '../parsing/rulespack.js';
import type { EmailMessage } from '../parsing/types.js';
import { ingestMessages, type IngestStats } from './ingest.js';
import type { SyncStore } from './store.js';

export type SyncKind = 'auto' | 'backfill' | 'incremental' | 'discovery';

export interface SyncSettings {
  windowDays: number;
  maxMessagesPerRun: number;
  discoverySweepHours: number;
  defaultCurrency: string;
  localeHint: string;
}

export interface SyncEngineDeps {
  store: SyncStore;
  gmail: GmailApi;
  rulesPack: () => RulesPack;
  settings: () => SyncSettings;
  llm?: () => LlmProvider | null;
  logger?: Logger;
  /** False when no Gmail account is connected. */
  isConnected: () => boolean | Promise<boolean>;
}

export type SyncPhase = 'starting' | 'history' | 'listing' | 'fetching' | 'done';

export interface SyncProgress {
  phase: SyncPhase;
  listed: number;
  /** Message ids still to process in this run (after skipping already-seen ones). */
  total: number;
  processed: number;
  created: number;
  duplicates: number;
}

export interface SyncRunOptions {
  force?: boolean;
  /** Epoch milliseconds. Work stops cleanly at the next checkpoint once this passes. */
  deadline?: number;
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncSummary extends IngestStats {
  runId: string;
  kind: SyncKind;
  listed: number;
  fetched: number;
  llmCalls: number;
  historyFallback: boolean;
  accountEmail: string;
  /** False when the run stopped at its deadline; the next run picks up where it left off. */
  complete: boolean;
}

const BATCH_SIZE = 20;

export function gmailMessageToEmail(message: GmailMessage): EmailMessage {
  const from = headerValue(message.payload, 'From');
  const bodies = extractBodies(message.payload);
  const email: EmailMessage = {
    gmailMessageId: message.id,
    from,
    senderAddress: parseAddress(from),
    subject: headerValue(message.payload, 'Subject'),
    headerDate: parseInternalDate(message),
    source: 'gmail',
  };
  if (message.threadId) email.gmailThreadId = message.threadId;
  if (bodies.text) email.textBody = bodies.text;
  if (bodies.html) email.htmlBody = bodies.html;
  if (message.snippet) email.snippet = message.snippet;
  return email;
}

export class SyncEngine {
  private inFlight: Promise<SyncSummary> | null = null;
  private readonly log: Logger;

  constructor(private readonly deps: SyncEngineDeps) {
    this.log = deps.logger ?? noopLogger;
  }

  isRunning(): boolean {
    return this.inFlight !== null;
  }

  /** Runs a sync. A second call while one is running returns the in-flight run. */
  run(kind: SyncKind = 'auto', options: SyncRunOptions = {}): Promise<SyncSummary> {
    if (this.inFlight) {
      // I reuse the active promise so repeated refreshes cannot start duplicate Gmail work.
      this.log.info('sync already running; returning the in-flight run');
      return this.inFlight;
    }
    this.inFlight = this.execute(kind, options).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private pastDeadline(options: SyncRunOptions): boolean {
    return options.deadline !== undefined && Date.now() >= options.deadline;
  }

  private async execute(kind: SyncKind, options: SyncRunOptions): Promise<SyncSummary> {
    const { store, gmail } = this.deps;
    // I check the connection before creating a run record, so a disconnected app leaves no fake run behind.
    if (!(await this.deps.isConnected())) throw new ReauthRequiredError('Connect a Gmail account before syncing.');

    const llm = this.deps.llm?.() ?? null;
    llm?.resetBudget?.();
    const settings = this.deps.settings();
    const pack = this.deps.rulesPack();
    const runId = await store.createSyncRun(kind);
    const totals: SyncSummary = {
      runId,
      kind,
      listed: 0,
      fetched: 0,
      processed: 0,
      parsed: 0,
      created: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      llmCalls: 0,
      historyFallback: false,
      accountEmail: 'unknown',
      complete: true,
    };
    const progress = (phase: SyncPhase, total = 0, processed = 0): void => {
      options.onProgress?.({ phase, listed: totals.listed, total, processed, created: totals.created, duplicates: totals.duplicates });
    };
    progress('starting');

    try {
      const profile = await gmail.getProfile();
      totals.accountEmail = profile.emailAddress;
      const state = await store.getSyncState(profile.emailAddress);

      let ids: string[] = [];
      let resolvedKind: SyncKind = kind;
      if (kind === 'auto') resolvedKind = state?.lastHistoryId ? 'incremental' : 'backfill';

      if (resolvedKind === 'incremental' && state?.lastHistoryId) {
        try {
          await store.updateSyncRun(runId, { phase: 'history' });
          progress('history');
          let pageToken: string | undefined;
          do {
            const page = await gmail.listHistory(state.lastHistoryId, pageToken);
            ids.push(...page.messageIds);
            pageToken = page.nextPageToken;
          } while (pageToken && ids.length < settings.maxMessagesPerRun);
          this.log.info('incremental sync found messages', { count: ids.length });
        } catch (err) {
          if (!(err instanceof HistoryExpiredError)) throw err;
          // Fires routinely for anyone who does not open the app for a week.
          this.log.warn('historyId expired; falling back to a full re-sync');
          totals.historyFallback = true;
          resolvedKind = 'backfill';
          ids = [];
        }
      } else if (resolvedKind === 'incremental') {
        resolvedKind = 'backfill';
      }

      if (resolvedKind !== 'incremental') {
        const promoted = await store.promotedSenders();
        const queries = tier1Queries(pack, promoted, settings.windowDays);
        const sweepDue =
          resolvedKind === 'discovery' ||
          !state?.lastDiscoverySweepAt ||
          Date.now() - new Date(state.lastDiscoverySweepAt).getTime() > settings.discoverySweepHours * 3600_000;
        if (sweepDue) {
          queries.push(tier2Query(pack, settings.windowDays));
          this.log.info('including discovery sweep in this run');
        }
        ids = await this.collectIds(queries, settings.maxMessagesPerRun, runId, totals, options);
        if (sweepDue && totals.complete) {
          await store.upsertSyncState(profile.emailAddress, { lastDiscoverySweepAt: new Date().toISOString() });
        }
      }

      totals.listed = ids.length;
      await store.updateSyncRun(runId, { listed: ids.length, phase: 'fetching' });

      await this.fetchAndIngest(ids, runId, totals, options, pack, settings, llm);

      const now = new Date().toISOString();
      totals.llmCalls = llm?.callsUsed?.() ?? 0;
      totals.kind = resolvedKind;

      if (totals.complete) {
        await store.upsertSyncState(profile.emailAddress, {
          lastHistoryId: profile.historyId,
          rulesPackVersion: pack.version,
          ...(resolvedKind === 'incremental'
            ? { lastIncrementalSyncAt: now }
            : { lastFullSyncAt: now, backfillCompletedThrough: now }),
        });
      }

      await store.updateSyncRun(runId, {
        status: totals.complete ? 'completed' : 'partial',
        phase: totals.complete ? 'done' : 'paused',
        finishedAt: now,
        listed: totals.listed,
        fetched: totals.fetched,
        parsed: totals.parsed,
        created: totals.created,
        duplicates: totals.duplicates,
        skipped: totals.skipped,
        failed: totals.failed,
      });
      progress('done');
      this.log.info(totals.complete ? 'sync completed' : 'sync paused at deadline', {
        kind: totals.kind,
        listed: totals.listed,
        created: totals.created,
        duplicates: totals.duplicates,
      });
      return totals;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof ReauthRequiredError ? 'reauth_required' : 'sync_failed';
      await store.updateSyncRun(runId, {
        status: 'failed',
        phase: 'error',
        finishedAt: new Date().toISOString(),
        errorCode: code,
        errorMessage: message,
        listed: totals.listed,
        fetched: totals.fetched,
        created: totals.created,
        failed: totals.failed,
      });
      this.log.error('sync failed', { code, err: message });
      throw err;
    }
  }

  private async collectIds(
    queries: string[],
    budget: number,
    runId: string,
    totals: SyncSummary,
    options: SyncRunOptions,
  ): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      let pageToken: string | undefined;
      do {
        if (this.pastDeadline(options)) {
          totals.complete = false;
          return ids;
        }
        const page = await this.deps.gmail.listMessages(query, pageToken, 100);
        for (const id of page.messageIds) {
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
        pageToken = page.nextPageToken;
        totals.listed = ids.length;
        await this.deps.store.updateSyncRun(runId, { listed: ids.length, phase: 'listing', pageToken: pageToken ?? null });
        options.onProgress?.({ phase: 'listing', listed: ids.length, total: 0, processed: 0, created: 0, duplicates: 0 });
        if (ids.length >= budget) {
          this.log.warn('message budget reached while listing', { budget });
          return ids.slice(0, budget);
        }
      } while (pageToken);
    }
    return ids;
  }

  private async fetchAndIngest(
    ids: string[],
    runId: string,
    totals: SyncSummary,
    options: SyncRunOptions,
    pack: RulesPack,
    settings: SyncSettings,
    llm: LlmProvider | null,
  ): Promise<void> {
    const { store, gmail } = this.deps;
    const force = options.force === true;
    const alreadySeen = force ? new Set<string>() : await store.seenMessageIds(ids, PARSER_VERSION);
    const pending = ids.filter((id) => !alreadySeen.has(id));
    options.onProgress?.({ phase: 'fetching', listed: totals.listed, total: pending.length, processed: 0, created: 0, duplicates: 0 });

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (this.pastDeadline(options)) {
        totals.complete = false;
        break;
      }
      const batch = pending.slice(i, i + BATCH_SIZE);
      const survivors: EmailMessage[] = [];

      for (const id of batch) {
        try {
          // Phase 1 — cheap metadata triage.
          const meta = await gmail.getMessageMetadata(id);
          totals.fetched += 1;
          const address = parseAddress(headerValue(meta.payload, 'From'));
          const subject = headerValue(meta.payload, 'Subject');
          const known = matchSender(pack, address) !== null;

          if (!subjectSurvivesTriage(subject, known)) {
            await store.markTriaged(id, address.split('@')[1] ?? 'unknown', 'triage-rejected', PARSER_VERSION);
            totals.skipped += 1;
            continue;
          }

          // Phase 2 — full body only for survivors. The body lives in memory only.
          const full = await gmail.getMessageFull(id);
          totals.fetched += 1;
          survivors.push(gmailMessageToEmail(full));
        } catch (err) {
          if (err instanceof ReauthRequiredError) throw err;
          totals.failed += 1;
          this.log.error('failed to fetch message', { err: err instanceof Error ? err.message : String(err) });
        }
      }

      if (survivors.length > 0) {
        const stats = await ingestMessages(
          survivors,
          { store, pack, defaultCurrency: settings.defaultCurrency, localeHint: settings.localeHint, llm, logger: this.log },
          { force },
        );
        totals.processed += stats.processed;
        totals.parsed += stats.parsed;
        totals.created += stats.created;
        totals.duplicates += stats.duplicates;
        totals.skipped += stats.skipped;
        totals.failed += stats.failed;
      }

      const done = Math.min(i + BATCH_SIZE, pending.length);
      await store.updateSyncRun(runId, {
        phase: `fetching ${done}/${pending.length}`,
        fetched: totals.fetched,
        parsed: totals.parsed,
        created: totals.created,
        duplicates: totals.duplicates,
        skipped: totals.skipped,
        failed: totals.failed,
      });
      options.onProgress?.({
        phase: 'fetching',
        listed: totals.listed,
        total: pending.length,
        processed: done,
        created: totals.created,
        duplicates: totals.duplicates,
      });
    }
  }
}
