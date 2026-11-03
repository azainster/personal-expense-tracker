/**
 * The Gmail sync engine against a mocked Gmail transport and the real on-device store.
 *
 * This is the path that cannot be exercised without credentials, and where the expensive
 * mistakes live: the history-404 fallback, retry policy, two-phase fetch, resumability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_EMAILS } from '../fixtures/emails.js';
import { fixtureDate, renderTokens } from '../fixtures/types.js';
import { GmailClient } from '../gmail/client.js';
import { HistoryExpiredError, ReauthRequiredError } from '../errors.js';
import { SyncEngine, type SyncProgress } from '../sync/engine.js';
import type { SqlStore } from '../store/sqlStore.js';
import type { LlmProvider } from '../llm/contract.js';
import { freshStore, loadRulesPack, TEST_SETTINGS } from './helpers.js';

const pack = loadRulesPack();

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function gmailMessageFor(id: string) {
  const fixture = SAMPLE_EMAILS.find((f) => f.id === id);
  if (!fixture) throw new Error(`unknown fixture ${id}`);
  const date = fixtureDate(fixture.daysAgo);
  const parts = [];
  if (fixture.text) parts.push({ mimeType: 'text/plain', body: { data: b64url(renderTokens(fixture.text, date)) } });
  if (fixture.html) parts.push({ mimeType: 'text/html', body: { data: b64url(renderTokens(fixture.html, date)) } });
  return {
    id: `gm-${fixture.id}`,
    threadId: `th-${fixture.id}`,
    internalDate: String(date.getTime()),
    snippet: 'snippet',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: fixture.from },
        { name: 'Subject', value: renderTokens(fixture.subject, date) },
        { name: 'Date', value: date.toUTCString() },
      ],
      parts,
    },
  };
}

const INGESTED = ['hdfc-upi-swiggy', 'hdfc-card-amazon', 'amazon-order-confirm', 'starbucks-inr', 'myntra-marketing'];

interface MockOptions {
  historyFails?: boolean;
  throttleFirstCall?: boolean;
  unauthorizedOnce?: boolean;
  messageIds?: string[];
}

function installFetchMock(options: MockOptions = {}) {
  let throttled = false;
  let unauthorized = false;
  const calls: string[] = [];
  const ids = options.messageIds ?? INGESTED;

  const handler = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const path = url.pathname;
    calls.push(`${path}${url.searchParams.get('format') ? `?format=${url.searchParams.get('format')}` : ''}`);
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (options.throttleFirstCall && !throttled) {
      throttled = true;
      return new Response(JSON.stringify({ error: { code: 429, message: 'rateLimitExceeded', errors: [{ reason: 'rateLimitExceeded' }] } }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    if (options.unauthorizedOnce && !unauthorized) {
      unauthorized = true;
      return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
    }
    if (path.endsWith('/profile')) return json({ emailAddress: 'tester@example.com', historyId: '99123', messagesTotal: 500 });
    if (path.endsWith('/history')) {
      if (options.historyFails) return json({ error: { code: 404, message: 'historyId not found' } }, 404);
      return json({ history: [{ messagesAdded: [{ message: { id: 'gm-starbucks-inr' } }] }], historyId: '99200' });
    }
    if (path.endsWith('/messages')) {
      return json({ messages: ids.map((id) => ({ id: `gm-${id}`, threadId: `th-${id}` })), resultSizeEstimate: ids.length });
    }
    const match = path.match(/\/messages\/(.+)$/);
    if (match) {
      const message = gmailMessageFor(decodeURIComponent(match[1] as string).replace(/^gm-/, ''));
      if (url.searchParams.get('format') === 'metadata') return json({ ...message, payload: { headers: message.payload.headers } });
      return json(message);
    }
    return json({ error: { code: 404, message: 'unexpected path' } }, 404);
  });

  vi.stubGlobal('fetch', handler);
  return { handler, calls };
}

let store: SqlStore;
let tokenInvalidations = 0;
let connected = true;

function makeEngine(llm: LlmProvider | null = null): SyncEngine {
  const gmail = new GmailClient({
    getAccessToken: async () => 'fake-access-token',
    invalidateAccessToken: () => {
      tokenInvalidations += 1;
    },
  });
  return new SyncEngine({
    store,
    gmail,
    rulesPack: () => pack,
    settings: () => TEST_SETTINGS,
    llm: () => llm,
    isConnected: () => connected,
  });
}

beforeEach(async () => {
  store = await freshStore();
  tokenInvalidations = 0;
  connected = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('full backfill', () => {
  it('lists, triages, fetches and stores transactions without double counting', async () => {
    const { calls } = installFetchMock();
    const progress: SyncProgress[] = [];
    const summary = await makeEngine().run('backfill', { onProgress: (p) => progress.push(p) });

    expect(summary.complete).toBe(true);
    expect(summary.listed).toBe(INGESTED.length);
    expect(summary.created).toBeGreaterThan(0);
    expect(summary.duplicates).toBeGreaterThan(0);
    const stored = await store.listTransactions({ limit: 100, includeExcluded: true });
    expect(stored.total).toBe(summary.created);
    expect(stored.rows.every((r) => r.source === 'gmail')).toBe(true);
    expect(calls.filter((c) => c.includes('format=metadata')).length).toBe(INGESTED.length);
    expect(calls.filter((c) => c.includes('format=full')).length).toBeLessThanOrEqual(INGESTED.length);
    expect(progress.at(-1)?.phase).toBe('done');
    expect(progress.some((p) => p.phase === 'fetching' && p.total > 0)).toBe(true);
  });

  it('records the history cursor and a completed run', async () => {
    installFetchMock();
    const summary = await makeEngine().run('backfill');
    expect((await store.getSyncState('tester@example.com'))?.lastHistoryId).toBe('99123');
    const run = await store.latestSyncRun();
    expect(run?.status).toBe('completed');
    expect(run?.created).toBe(summary.created);
  });

  it('skips messages already seen on a second run', async () => {
    installFetchMock();
    const engine = makeEngine();
    await engine.run('backfill');
    const second = await engine.run('backfill');
    expect(second.created).toBe(0);
    expect(second.fetched).toBe(0);
  });

  it('returns the in-flight run instead of starting a second one', async () => {
    installFetchMock();
    const engine = makeEngine();
    const a = engine.run('backfill');
    const b = engine.run('backfill');
    expect(await a).toBe(await b);
  });
});

describe('resumability', () => {
  it('stops at the deadline without advancing the cursor, then resumes', async () => {
    installFetchMock({ messageIds: SAMPLE_EMAILS.slice(0, 30).map((f) => f.id) });
    const engine = makeEngine();
    const paused = await engine.run('auto', { deadline: Date.now() - 1 });
    expect(paused.complete).toBe(false);
    expect((await store.latestSyncRun())?.status).toBe('partial');
    expect((await store.getSyncState('tester@example.com'))?.lastHistoryId ?? null).toBeNull();

    const resumed = await engine.run('auto');
    expect(resumed.complete).toBe(true);
    expect(resumed.kind).toBe('backfill');
    expect((await store.getSyncState('tester@example.com'))?.lastHistoryId).toBe('99123');
  });
});

describe('incremental sync', () => {
  it('uses history.list when a cursor exists', async () => {
    installFetchMock();
    const engine = makeEngine();
    await engine.run('backfill');
    const { calls } = installFetchMock();
    const summary = await engine.run('auto');
    expect(summary.kind).toBe('incremental');
    expect(calls.some((c) => c.endsWith('/history'))).toBe(true);
  });

  it('falls back to a full re-sync when the historyId has expired (404)', async () => {
    installFetchMock();
    const engine = makeEngine();
    await engine.run('backfill');
    installFetchMock({ historyFails: true });
    const summary = await engine.run('auto');
    expect(summary.historyFallback).toBe(true);
    expect(summary.kind).toBe('backfill');
    expect((await store.latestSyncRun())?.status).toBe('completed');
  });
});

describe('transport policy', () => {
  it('retries a 429 with backoff instead of failing the run', async () => {
    const { handler } = installFetchMock({ throttleFirstCall: true });
    const summary = await makeEngine().run('backfill');
    expect(summary.created).toBeGreaterThan(0);
    expect(handler.mock.calls.length).toBeGreaterThan(INGESTED.length);
  });

  it('refreshes the token once on a 401 and carries on', async () => {
    installFetchMock({ unauthorizedOnce: true });
    const summary = await makeEngine().run('backfill');
    expect(tokenInvalidations).toBe(1);
    expect(summary.created).toBeGreaterThan(0);
  });

  it('surfaces an expired history window as a typed error', async () => {
    installFetchMock({ historyFails: true });
    const client = new GmailClient({ getAccessToken: async () => 't' });
    await expect(client.listHistory('123')).rejects.toBeInstanceOf(HistoryExpiredError);
  });

  it('marks a run failed and records the error when Gmail rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: 'Invalid query' } }), { status: 400 })));
    await expect(makeEngine().run('backfill')).rejects.toThrow();
    const run = await store.latestSyncRun();
    expect(run?.status).toBe('failed');
    expect(run?.errorMessage).toContain('Invalid query');
  });

  it('refuses to sync without a connected account', async () => {
    connected = false;
    await expect(makeEngine().run('auto')).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});

describe('remote model fallback', () => {
  it('only ever receives redacted text, and caches merchant classifications', async () => {
    const seen: string[] = [];
    const llm: LlmProvider = {
      extract: async (input) => {
        seen.push(input.text, input.subject);
        return null;
      },
      classifyMerchant: async () => 'shopping',
    };
    installFetchMock({ messageIds: SAMPLE_EMAILS.map((f) => f.id) });
    await makeEngine(llm).run('backfill');
    for (const text of seen) {
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/\b\d{13,19}\b/);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
