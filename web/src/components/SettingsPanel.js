import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/format';
import { Banner, ErrorState, LoadingCard } from './States';
export function SettingsPanel({ status, statusError, onRefresh, onDataChanged }) {
    const [busy, setBusy] = useState(null);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [failures, setFailures] = useState(null);
    useEffect(() => {
        api.failures().then(setFailures).catch(() => setFailures(null));
    }, [status?.latestRun?.id]);
    const run = async (label, fn) => {
        setBusy(label);
        setError(null);
        setMessage(null);
        try {
            setMessage(await fn());
            onRefresh();
            onDataChanged();
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
        finally {
            setBusy(null);
        }
    };
    if (statusError)
        return _jsx(ErrorState, { message: statusError, onRetry: onRefresh });
    if (!status)
        return _jsx("div", { className: "card", children: _jsx(LoadingCard, { lines: 4 }) });
    const { connection } = status;
    return (_jsxs("div", { className: "vstack", style: { gap: 16 }, children: [message && _jsx(Banner, { kind: "info", onDismiss: () => setMessage(null), children: message }), error && _jsx(Banner, { kind: "error", onDismiss: () => setError(null), children: error }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Gmail connection" }), _jsx("span", { className: "card-note", children: connection.connected ? 'connected' : 'not connected' })] }), !connection.configured ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "small", children: ["Gmail is not configured on the server. Set ", _jsx("code", { className: "mono", children: "GOOGLE_CLIENT_ID" }), " and", ' ', _jsx("code", { className: "mono", children: "GOOGLE_CLIENT_SECRET" }), " in ", _jsx("code", { className: "mono", children: ".env" }), ", then restart. Everything else \u2014 parsing, categorisation, the dashboard \u2014 works on sample data without it."] }), _jsxs("p", { className: "muted small", children: ["The scope needed is ", _jsx("code", { className: "mono", children: "gmail.readonly" }), ", which Google classifies as restricted. Keep the consent screen in Testing mode with your own account as a test user; the refresh token then expires every 7 days, which is Google's behaviour and not a bug here."] })] })) : connection.connected ? (_jsxs(_Fragment, { children: [_jsxs("dl", { className: "field-grid", children: [_jsx("dt", { children: "Account" }), _jsx("dd", { className: "mono", children: connection.accountEmail }), _jsx("dt", { children: "Last full sync" }), _jsx("dd", { children: relativeTime(status.state?.lastFullSyncAt ?? null) }), _jsx("dt", { children: "Last incremental" }), _jsx("dd", { children: relativeTime(status.state?.lastIncrementalSyncAt ?? null) }), _jsx("dt", { children: "History cursor" }), _jsx("dd", { className: "mono", children: status.state?.lastHistoryId ?? '—' })] }), connection.tokenKeyIsEphemeral && (_jsx(Banner, { kind: "warn", children: "TOKEN_ENCRYPTION_KEY is unset, so this connection will not survive a server restart." })), _jsxs("div", { className: "hstack", style: { marginTop: 12 }, children: [_jsx("button", { className: "btn btn-primary", disabled: busy !== null || status.running, onClick: () => void run('sync', async () => {
                                            const { summary } = await api.runSync('auto');
                                            return `Sync finished: ${summary.created} new, ${summary.duplicates} duplicates merged, ${summary.failed} not parsed.`;
                                        }), children: status.running || busy === 'sync' ? 'Syncing…' : 'Sync now' }), _jsx("button", { className: "btn", disabled: busy !== null || status.running, onClick: () => void run('backfill', async () => {
                                            const { summary } = await api.runSync('backfill');
                                            return `Backfill finished: ${summary.created} new transactions.`;
                                        }), children: "Full backfill" }), _jsx("button", { className: "btn", disabled: busy !== null || status.running, onClick: () => void run('discovery', async () => {
                                            const { summary } = await api.runSync('discovery');
                                            return `Discovery sweep finished: ${summary.created} new transactions.`;
                                        }), children: "Discovery sweep" }), _jsx("span", { className: "spacer" }), _jsx("button", { className: "btn btn-danger", disabled: busy !== null, onClick: () => {
                                            const wipe = window.confirm('Also delete all locally stored transactions?');
                                            void run('disconnect', async () => {
                                                await api.disconnect(wipe);
                                                return wipe ? 'Disconnected and local data wiped.' : 'Disconnected. Local data kept.';
                                            });
                                        }, children: "Disconnect" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "small", children: "Connect a Gmail account to ingest real transaction emails. Nothing is stored except the extracted transaction and the message id \u2014 email bodies are never persisted." }), _jsx("a", { className: "btn btn-primary", href: "/api/auth/google/start", children: "Connect Gmail" })] }))] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Sample data" }), _jsx("span", { className: "card-note", children: "demo mode" })] }), _jsx("p", { className: "small", children: "Runs the bundled fixture corpus through the real parsing pipeline, so the dashboard can be exercised without Gmail. These are parser outputs, not hand-written rows." }), _jsxs("div", { className: "hstack", children: [_jsx("button", { className: "btn", disabled: busy !== null, onClick: () => void run('seed', async () => {
                                    const { seeded } = await api.seedSampleData(true);
                                    return `Seeded ${seeded.created} transactions, merged ${seeded.duplicates} duplicates, rejected ${seeded.rejected} non-transactions.`;
                                }), children: "Load sample data" }), _jsx("button", { className: "btn btn-danger", disabled: busy !== null, onClick: () => void run('clear', async () => {
                                    const { removed } = await api.clearSampleData();
                                    return `Removed ${removed} sample transactions.`;
                                }), children: "Remove sample data" })] })] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Recent sync runs" }), _jsx("button", { className: "btn btn-sm", onClick: onRefresh, children: "Refresh" })] }), status.recentRuns.length === 0 ? (_jsx("p", { className: "muted small", children: "No sync has run yet." })) : (_jsxs("table", { className: "cat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Started" }), _jsx("th", { children: "Kind" }), _jsx("th", { children: "Status" }), _jsx("th", { className: "num", children: "Listed" }), _jsx("th", { className: "num", children: "New" }), _jsx("th", { className: "num", children: "Dupes" }), _jsx("th", { className: "num", children: "Failed" })] }) }), _jsx("tbody", { children: status.recentRuns.map((run_) => (_jsxs("tr", { children: [_jsx("td", { children: relativeTime(run_.startedAt) }), _jsx("td", { className: "mono", children: run_.kind }), _jsxs("td", { children: [run_.status, run_.errorMessage && _jsx("div", { className: "muted small", children: run_.errorMessage })] }), _jsx("td", { className: "num", children: run_.listed }), _jsx("td", { className: "num", children: run_.created }), _jsx("td", { className: "num", children: run_.duplicates }), _jsx("td", { className: "num", children: run_.failed })] }, run_.id))) })] }))] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Parse failures" }), _jsx("span", { className: "card-note", children: "content-free telemetry" })] }), _jsx("p", { className: "muted small", children: "Only the sender domain and the shape of the subject line are recorded \u2014 never the subject or the body. A domain climbing this list is the signal that its template needs fixing in the rules pack." }), failures === null || failures.failures.length === 0 ? (_jsx("p", { className: "muted small", children: "No parse failures recorded." })) : (_jsxs("table", { className: "cat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Sender domain" }), _jsx("th", { className: "num", children: "Failures" }), _jsx("th", { children: "Last stage" })] }) }), _jsx("tbody", { children: failures.failures.map((f) => (_jsxs("tr", { children: [_jsx("td", { className: "mono", children: f.senderDomain }), _jsx("td", { className: "num", children: f.count }), _jsx("td", { className: "mono", children: f.lastStage })] }, f.senderDomain))) })] }))] }), _jsxs("section", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("h2", { className: "card-title", children: "Engine" }) }), _jsxs("dl", { className: "field-grid", children: [_jsx("dt", { children: "Parser version" }), _jsx("dd", { className: "mono", children: status.parserVersion }), _jsx("dt", { children: "Rules pack" }), _jsx("dd", { className: "mono", children: status.rulesPackVersion }), _jsx("dt", { children: "Sync window" }), _jsxs("dd", { children: [status.windowDays, " days"] }), _jsx("dt", { children: "Background sync" }), _jsx("dd", { children: status.schedulerMinutes > 0 ? `every ${status.schedulerMinutes} min` : 'manual only' }), _jsx("dt", { children: "Remote LLM (L4)" }), _jsx("dd", { children: status.remoteLlmEnabled ? 'enabled (opt-in)' : 'off' })] }), _jsx("button", { className: "btn btn-sm", style: { marginTop: 12 }, disabled: busy !== null, onClick: () => void run('rules', async () => {
                            const result = await api.reloadRules();
                            return `Rules pack ${result.version} reloaded: ${result.senders} senders, ${result.merchants} merchants.`;
                        }), children: "Reload rules pack" })] })] }));
}
