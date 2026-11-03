/**
 * Gmail sync loop against a mocked transport.
 *
 * This is the one path that cannot be exercised without real credentials, and it is where
 * the expensive mistakes live: the history-404 fallback, the retry policy, and the
 * two-phase fetch. So it gets a fake Gmail instead of no coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, truncateAll } from '../db/index.js';
import * as repo from '../db/repo.js';
import { encryptSecret } from '../gmail/crypto.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { fixtureDate, renderTokens, SAMPLE_EMAILS } from '@expense/core';
import { runSync } from '../sync/service.js';
import { HistoryExpiredError } from '../errors.js';
import * as client from '../gmail/client.js';

const pack = loadRulesPack();

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Builds a Gmail API `messages.get?format=full` payload from a bundled fixture. */
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
}

function installFetchMock(options: MockOptions = {}) {
  let throttled = false;
  const calls: string[] = [];

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

    if (path.endsWith('/profile')) {
      return json({ emailAddress: 'tester@example.com', historyId: '99123', messagesTotal: 500 });
    }
    if (path.endsWith('/history')) {
      if (options.historyFails) return json({ error: { code: 404, message: 'historyId not found' } }, 404);
      return json({ history: [{ messagesAdded: [{ message: { id: 'gm-starbucks-inr' } }] }], historyId: '99200' });
    }
    if (path.endsWith('/messages')) {
      return json({ messages: INGESTED.map((id) => ({ id: `gm-${id}`, threadId: `th-${id}` })), resultSizeEstimate: INGESTED.length });
    }
    const match = path.match(/\/messages\/(.+)$/);
    if (match) {
      const fixtureId = decodeURIComponent(match[1] as string).replace(/^gm-/, '');
      const message = gmailMessageFor(fixtureId);
      if (url.searchParams.get('format') === 'metadata') {
        return json({ ...message, payload: { headers: message.payload.headers } });
      }
      return json(message);
    }
    return json({ error: { code: 404, message: 'unexpected path' } }, 404);
  });

  vi.stubGlobal('fetch', handler);
  return { handler, calls };
}

beforeEach(() => {
  getDb();
  truncateAll();
  repo.seedCategories(pack.categories);
  repo.seedMerchantRules(pack);
  // A connected account with a still-valid access token, so no refresh round trip happens.
  repo.saveTokens({
    accountEmail: 'tester@example.com',
    refreshTokenEnc: encryptSecret('fake-refresh-token'),
    accessTokenEnc: encryptSecret('fake-access-token'),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('full backfill', () => {
  it('lists, triages, fetches and stores transactions', async () => {
    const { calls } = installFetchMock();
    const summary = await runSync('backfill');

    expect(summary.listed).toBe(INGESTED.length);
    expect(summary.created).toBeGreaterThan(0);
    // The bank alert and the merchant receipt for the same purchase must not both count.
    expect(summary.duplicates).toBeGreaterThan(0);

    const stored = repo.listTransactions({ limit: 100 });
    expect(stored.total).toBe(summary.created);
    expect(stored.rows.every((r) => r.source === 'gmail')).toBe(true);

    // Two-phase fetch: metadata first, full bodies only for survivors.
    expect(calls.filter((c) => c.includes('format=metadata')).length).toBe(INGESTED.length);
    expect(calls.filter((c) => c.includes('format=full')).length).toBeLessThanOrEqual(INGESTED.length);
  });

  it('records the history cursor so the next run can be incremental', async () => {
    installFetchMock();
    await runSync('backfill');
    expect(repo.getSyncState('tester@example.com')?.lastHistoryId).toBe('99123');
  });

  it('writes a completed sync run with counters', async () => {
    installFetchMock();
    const summary = await runSync('backfill');
    const run = repo.latestSyncRun();
    expect(run?.status).toBe('completed');
    expect(run?.created).toBe(summary.created);
    expect(run?.finishedAt).not.toBeNull();
  });

  it('skips messages already seen by this parser version on a second run', async () => {
    installFetchMock();
    await runSync('backfill');
    const second = await runSync('backfill');
    expect(second.created).toBe(0);
    expect(second.fetched).toBe(0);
  });
});

describe('incremental sync', () => {
  it('uses history.list when a cursor exists', async () => {
    installFetchMock();
    await runSync('backfill');
    const { calls } = installFetchMock();
    const summary = await runSync('auto');
    expect(summary.kind).toBe('incremental');
    expect(calls.some((c) => c.endsWith('/history'))).toBe(true);
  });

  it('falls back to a full re-sync when the historyId has expired (404)', async () => {
    installFetchMock();
    await runSync('backfill');

    // This fires routinely for anyone who does not open the app for a week.
    installFetchMock({ historyFails: true });
    const summary = await runSync('auto');
    expect(summary.historyFallback).toBe(true);
    expect(summary.kind).toBe('backfill');
    const run = repo.latestSyncRun();
    expect(run?.status).toBe('completed');
  });
});

describe('transport policy', () => {
  it('retries a 429 with backoff instead of failing the run', async () => {
    const { handler } = installFetchMock({ throttleFirstCall: true });
    const summary = await runSync('backfill');
    expect(summary.created).toBeGreaterThan(0);
    expect(handler.mock.calls.length).toBeGreaterThan(INGESTED.length);
  });

  it('surfaces an expired history window as a typed error', async () => {
    installFetchMock({ historyFails: true });
    await expect(client.listHistory('123')).rejects.toBeInstanceOf(HistoryExpiredError);
  });

  it('marks a run failed and records the error when the transport gives up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: 'Invalid query' } }), { status: 400 })));
    await expect(runSync('backfill')).rejects.toThrow();
    const run = repo.latestSyncRun();
    expect(run?.status).toBe('failed');
    expect(run?.errorMessage).toContain('Invalid query');
  });
});
