export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'ApiError';
    }
}
async function request(path, init) {
    let response;
    try {
        response = await fetch(`/api${path}`, {
            ...init,
            headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        });
    }
    catch {
        throw new ApiError('Cannot reach the server. Is it running on port 4000?', 0, 'network_error');
    }
    if (response.status === 204)
        return undefined;
    const text = await response.text();
    let payload = null;
    try {
        payload = text === '' ? null : JSON.parse(text);
    }
    catch {
        throw new ApiError('The server returned a malformed response.', response.status, 'bad_response');
    }
    if (!response.ok) {
        const error = payload?.error;
        throw new ApiError(error?.message ?? `Request failed (${response.status})`, response.status, error?.code ?? 'error');
    }
    return payload;
}
export const api = {
    health: () => request('/health'),
    summary: (month, currency) => {
        const params = new URLSearchParams();
        if (month)
            params.set('month', month);
        if (currency)
            params.set('currency', currency);
        const query = params.toString();
        return request(`/stats/summary${query ? `?${query}` : ''}`);
    },
    transactions: (options) => {
        const params = new URLSearchParams();
        if (options.month)
            params.set('month', options.month);
        if (options.category)
            params.set('category', options.category);
        if (options.search)
            params.set('search', options.search);
        if (options.needsReview)
            params.set('needsReview', 'true');
        if (options.includeExcluded)
            params.set('includeExcluded', 'true');
        params.set('limit', String(options.limit ?? 200));
        return request(`/transactions?${params.toString()}`);
    },
    transaction: (id) => request(`/transactions/${id}`),
    categories: () => request('/categories'),
    recategorize: (id, categoryKey) => request(`/transactions/${id}/category`, { method: 'PATCH', body: JSON.stringify({ categoryKey }) }),
    undoRecategorize: (undoToken) => request('/transactions/undo-recategorize', {
        method: 'POST',
        body: JSON.stringify({ undoToken }),
    }),
    updateTransaction: (id, fields) => request(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    syncStatus: () => request('/sync/status'),
    runSync: (kind) => request('/sync/run', {
        method: 'POST',
        body: JSON.stringify({ kind }),
    }),
    seedSampleData: (reset = false) => request('/sync/sample-data', {
        method: 'POST',
        body: JSON.stringify({ reset }),
    }),
    clearSampleData: () => request('/sync/sample-data', { method: 'DELETE' }),
    failures: () => request('/sync/failures'),
    disconnect: (wipeLocalData) => request('/auth/disconnect', { method: 'POST', body: JSON.stringify({ wipeLocalData }) }),
    authUrl: () => request('/auth/google/url', { method: 'POST' }),
    fixtures: () => request('/debug/fixtures'),
    parseFixture: (fixtureId) => request('/debug/parse', { method: 'POST', body: JSON.stringify({ fixtureId }) }),
    parseRaw: (input) => request('/debug/parse', { method: 'POST', body: JSON.stringify(input) }),
    reloadRules: () => request('/debug/rules/reload', { method: 'POST' }),
};
