import type { Category, FixtureSummary, DuplicateLink, ParseTrace, Summary, SyncStatus, Transaction } from '../types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running on port 4000?', 0, 'network_error');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    throw new ApiError('The server returned a malformed response.', response.status, 'bad_response');
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(error?.message ?? `Request failed (${response.status})`, response.status, error?.code ?? 'error');
  }
  return payload as T;
}

export const api = {
  health: () => request<{ status: string; parserVersion: string; rulesPackVersion: string }>('/health'),

  summary: (month?: string, currency?: string) => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (currency) params.set('currency', currency);
    const query = params.toString();
    return request<Summary>(`/stats/summary${query ? `?${query}` : ''}`);
  },

  transactions: (options: {
    month?: string;
    category?: string;
    search?: string;
    needsReview?: boolean;
    includeExcluded?: boolean;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    if (options.month) params.set('month', options.month);
    if (options.category) params.set('category', options.category);
    if (options.search) params.set('search', options.search);
    if (options.needsReview) params.set('needsReview', 'true');
    if (options.includeExcluded) params.set('includeExcluded', 'true');
    params.set('limit', String(options.limit ?? 200));
    return request<{ transactions: Transaction[]; total: number }>(`/transactions?${params.toString()}`);
  },

  transaction: (id: string) => request<{ transaction: Transaction; duplicates: DuplicateLink[] }>(`/transactions/${id}`),

  categories: () => request<{ categories: Category[]; rulesPackVersion: string }>('/categories'),

  recategorize: (id: string, categoryKey: string) =>
    request<{ transaction: Transaction; retroactivelyUpdated: number; undoToken: string | null }>(
      `/transactions/${id}/category`,
      { method: 'PATCH', body: JSON.stringify({ categoryKey }) },
    ),

  undoRecategorize: (undoToken: string) =>
    request<{ restored: number }>('/transactions/undo-recategorize', {
      method: 'POST',
      body: JSON.stringify({ undoToken }),
    }),

  updateTransaction: (id: string, fields: Record<string, unknown>) =>
    request<{ transaction: Transaction }>(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),

  syncStatus: () => request<SyncStatus>('/sync/status'),

  runSync: (kind: string) =>
    request<{ summary: Record<string, number | string | boolean> }>('/sync/run', {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),

  seedSampleData: (reset = false) =>
    request<{ seeded: { created: number; duplicates: number; rejected: number; skipped: number } }>('/sync/sample-data', {
      method: 'POST',
      body: JSON.stringify({ reset }),
    }),

  clearSampleData: () => request<{ removed: number }>('/sync/sample-data', { method: 'DELETE' }),

  failures: () =>
    request<{
      failures: Array<{ senderDomain: string; count: number; lastStage: string; lastSeen: string }>;
      discoveredSenders: Array<{ address: string; domain: string; success: number; failure: number }>;
    }>('/sync/failures'),

  disconnect: (wipeLocalData: boolean) =>
    request<{ disconnected: boolean }>('/auth/disconnect', { method: 'POST', body: JSON.stringify({ wipeLocalData }) }),

  authUrl: () => request<{ url: string }>('/auth/google/url', { method: 'POST' }),

  fixtures: () => request<{ fixtures: FixtureSummary[] }>('/debug/fixtures'),

  parseFixture: (fixtureId: string) =>
    request<ParseTrace>('/debug/parse', { method: 'POST', body: JSON.stringify({ fixtureId }) }),

  parseRaw: (input: { from: string; subject: string; text?: string; html?: string }) =>
    request<ParseTrace>('/debug/parse', { method: 'POST', body: JSON.stringify(input) }),

  reloadRules: () =>
    request<{ version: string; senders: number; merchants: number }>('/debug/rules/reload', { method: 'POST' }),
};
