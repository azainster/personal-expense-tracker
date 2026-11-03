/**
 * Gmail REST client (§2.3, §2.4). Shared by the iPhone app and the development server.
 *
 *  - token-bucket limiter (~40 requests/sec ceiling) so an aggressive backfill cannot trip
 *    the per-user quota;
 *  - exponential backoff with **full jitter** on 429 / 403 rateLimitExceeded / 5xx, honouring
 *    Retry-After;
 *  - 400 / 404 are never retried; a 401 gets exactly one retry after the access token is
 *    invalidated (it may simply have expired in flight), then becomes ReauthRequiredError;
 *  - history.list 404 means the historyId aged out → HistoryExpiredError, and the caller
 *    falls back to a full re-sync. This fires routinely, not exceptionally.
 *
 * Query strings are built by hand: React Native's URL/URLSearchParams are not reliable.
 */
import { HistoryExpiredError, ReauthRequiredError, UpstreamError } from '../errors.js';
import { noopLogger, type Logger } from '../logger.js';
import type { GmailMessage } from './mime.js';

const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** The only scope the app needs. `gmail.metadata` strips bodies; nothing narrower works (§0). */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly capacity: number, private readonly refillPerSecond: number) {
    this.tokens = capacity;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
      await sleep(Math.max(10, waitMs));
    }
  }
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 20_000;

function fullJitter(attempt: number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type QueryValue = string | string[] | undefined;

export function buildQueryString(params: Record<string, QueryValue>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
  }
  return pairs.join('&');
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; errors?: Array<{ reason?: string }> };
}

export interface ListPage {
  messageIds: string[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface HistoryPage {
  messageIds: string[];
  historyId: string | null;
  nextPageToken?: string;
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
  messagesTotal: number;
}

/** What the sync engine needs from Gmail — implemented by GmailClient, mockable in tests. */
export interface GmailApi {
  listMessages(query: string, pageToken?: string, maxResults?: number): Promise<ListPage>;
  getMessageMetadata(id: string): Promise<GmailMessage>;
  getMessageFull(id: string): Promise<GmailMessage>;
  getProfile(): Promise<GmailProfile>;
  listHistory(startHistoryId: string, pageToken?: string): Promise<HistoryPage>;
}

export interface GmailClientOptions {
  /** Returns a currently valid access token, refreshing it if needed. */
  getAccessToken: () => Promise<string>;
  /** Called on a 401 so the next getAccessToken() refreshes instead of reusing the cached token. */
  invalidateAccessToken?: () => void | Promise<void>;
  /** Defaults to the global fetch, resolved at call time (tests stub it). */
  fetch?: typeof fetch;
  logger?: Logger;
  requestsPerSecond?: number;
}

export class GmailClient implements GmailApi {
  private readonly bucket: TokenBucket;
  private readonly log: Logger;

  constructor(private readonly options: GmailClientOptions) {
    const rate = options.requestsPerSecond ?? 40;
    this.bucket = new TokenBucket(rate, rate);
    this.log = options.logger ?? noopLogger;
  }

  private async request<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    const query = buildQueryString(params ?? {});
    const url = query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
    const doFetch = this.options.fetch ?? globalThis.fetch;

    let lastError: unknown = null;
    let reauthRetried = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await this.bucket.take();
      const accessToken = await this.options.getAccessToken();

      let response: Response;
      try {
        response = await doFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      } catch (err) {
        lastError = err;
        this.log.warn('gmail request failed at the network layer', { attempt, path });
        await sleep(fullJitter(attempt));
        continue;
      }

      if (response.ok) return (await response.json()) as T;

      const text = await response.text();
      let body: GoogleErrorBody = {};
      try {
        body = JSON.parse(text) as GoogleErrorBody;
      } catch {
        /* non-JSON error body */
      }
      const reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? '';
      const message = body.error?.message ?? response.statusText;

      if (response.status === 404) {
        if (path.startsWith('/history')) throw new HistoryExpiredError();
        throw new UpstreamError(`Gmail resource not found: ${message}`, { status: 404 });
      }
      if (response.status === 401) {
        if (!reauthRetried && this.options.invalidateAccessToken) {
          reauthRetried = true;
          await this.options.invalidateAccessToken();
          attempt -= 1;
          continue;
        }
        throw new ReauthRequiredError('Gmail rejected the access token. Reconnect the account.');
      }
      if (response.status === 400) {
        throw new UpstreamError(`Gmail rejected the request: ${message}`, { status: 400, details: { reason } });
      }
      if (response.status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(`${reason} ${message}`)) {
        throw new ReauthRequiredError('Gmail read access was not granted. Reconnect and allow "Read your email".');
      }

      const retryable =
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 && /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(reason));

      if (!retryable) {
        throw new UpstreamError(`Gmail returned ${response.status}: ${message}`, { status: 502, details: { reason } });
      }

      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fullJitter(attempt);
      this.log.warn('gmail throttled; backing off', { status: response.status, reason, attempt, delayMs: Math.round(delay) });
      lastError = new UpstreamError(`Gmail returned ${response.status}: ${message}`, { status: 502, retryable: true });
      await sleep(delay);
    }

    throw lastError instanceof UpstreamError
      ? lastError
      : new UpstreamError('Could not reach Gmail. Check your connection and try again.', { retryable: true, cause: lastError });
  }

  async listMessages(query: string, pageToken?: string, maxResults = 100): Promise<ListPage> {
    const data = await this.request<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>('/messages', {
      q: query,
      maxResults: String(maxResults),
      ...(pageToken ? { pageToken } : {}),
    });
    return {
      messageIds: (data.messages ?? []).map((m) => m.id),
      ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
      resultSizeEstimate: data.resultSizeEstimate ?? 0,
    };
  }

  /** Phase 1 of the two-phase fetch: headers only, for cheap triage. */
  getMessageMetadata(id: string): Promise<GmailMessage> {
    return this.request<GmailMessage>(`/messages/${encodeURIComponent(id)}`, {
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
  }

  /** Phase 2: full body, only for survivors of triage. */
  getMessageFull(id: string): Promise<GmailMessage> {
    return this.request<GmailMessage>(`/messages/${encodeURIComponent(id)}`, { format: 'full' });
  }

  getProfile(): Promise<GmailProfile> {
    return this.request<GmailProfile>('/profile');
  }

  /** Incremental sync. 2 quota units instead of 5, and returns only what changed. */
  async listHistory(startHistoryId: string, pageToken?: string): Promise<HistoryPage> {
    const data = await this.request<{
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    }>('/history', {
      startHistoryId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
      maxResults: '200',
      ...(pageToken ? { pageToken } : {}),
    });

    const ids = new Set<string>();
    for (const record of data.history ?? []) {
      for (const added of record.messagesAdded ?? []) ids.add(added.message.id);
    }
    return {
      messageIds: [...ids],
      historyId: data.historyId ?? null,
      ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
    };
  }
}
