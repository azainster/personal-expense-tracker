import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { SyncStatus } from '../types';
import { Banner, ErrorState, LoadingCard } from './States';

interface Props {
  status: SyncStatus | null;
  statusError: string | null;
  onRefresh: () => void;
  onDataChanged: () => void;
}

export function SettingsPanel({ status, statusError, onRefresh, onDataChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Awaited<ReturnType<typeof api.failures>> | null>(null);

  useEffect(() => {
    api.failures().then(setFailures).catch(() => setFailures(null));
  }, [status?.latestRun?.id]);

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      onRefresh();
      onDataChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (statusError) return <ErrorState message={statusError} onRetry={onRefresh} />;
  if (!status) return <div className="card"><LoadingCard lines={4} /></div>;

  const { connection } = status;

  return (
    <div className="vstack" style={{ gap: 16 }}>
      {message && <Banner kind="info" onDismiss={() => setMessage(null)}>{message}</Banner>}
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Gmail connection</h2>
          <span className="card-note">{connection.connected ? 'connected' : 'not connected'}</span>
        </div>

        {!connection.configured ? (
          <>
            <p className="small">
              Gmail is not configured on the server. Set <code className="mono">GOOGLE_CLIENT_ID</code> and{' '}
              <code className="mono">GOOGLE_CLIENT_SECRET</code> in <code className="mono">.env</code>, then restart.
              Everything else — parsing, categorisation, the dashboard — works on sample data without it.
            </p>
            <p className="muted small">
              The scope needed is <code className="mono">gmail.readonly</code>, which Google classifies as restricted.
              Keep the consent screen in Testing mode with your own account as a test user; the refresh token then
              expires every 7 days, which is Google's behaviour and not a bug here.
            </p>
          </>
        ) : connection.connected ? (
          <>
            <dl className="field-grid">
              <dt>Account</dt><dd className="mono">{connection.accountEmail}</dd>
              <dt>Last full sync</dt><dd>{relativeTime(status.state?.lastFullSyncAt ?? null)}</dd>
              <dt>Last incremental</dt><dd>{relativeTime(status.state?.lastIncrementalSyncAt ?? null)}</dd>
              <dt>History cursor</dt><dd className="mono">{status.state?.lastHistoryId ?? '—'}</dd>
            </dl>
            {connection.tokenKeyIsEphemeral && (
              <Banner kind="warn">
                TOKEN_ENCRYPTION_KEY is unset, so this connection will not survive a server restart.
              </Banner>
            )}
            <div className="hstack" style={{ marginTop: 12 }}>
              <button
                className="btn btn-primary"
                disabled={busy !== null || status.running}
                onClick={() => void run('sync', async () => {
                  const { summary } = await api.runSync('auto');
                  return `Sync finished: ${summary.created} new, ${summary.duplicates} duplicates merged, ${summary.failed} not parsed.`;
                })}
              >
                {status.running || busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                className="btn"
                disabled={busy !== null || status.running}
                onClick={() => void run('backfill', async () => {
                  const { summary } = await api.runSync('backfill');
                  return `Backfill finished: ${summary.created} new transactions.`;
                })}
              >
                Full backfill
              </button>
              <button
                className="btn"
                disabled={busy !== null || status.running}
                onClick={() => void run('discovery', async () => {
                  const { summary } = await api.runSync('discovery');
                  return `Discovery sweep finished: ${summary.created} new transactions.`;
                })}
              >
                Discovery sweep
              </button>
              <span className="spacer" />
              <button
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={() => {
                  const wipe = window.confirm('Also delete all locally stored transactions?');
                  void run('disconnect', async () => {
                    await api.disconnect(wipe);
                    return wipe ? 'Disconnected and local data wiped.' : 'Disconnected. Local data kept.';
                  });
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="small">
              Connect a Gmail account to ingest real transaction emails. Nothing is stored except the extracted
              transaction and the message id — email bodies are never persisted.
            </p>
            <a className="btn btn-primary" href="/api/auth/google/start">Connect Gmail</a>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Sample data</h2>
          <span className="card-note">demo mode</span>
        </div>
        <p className="small">
          Runs the bundled fixture corpus through the real parsing pipeline, so the dashboard can be exercised
          without Gmail. These are parser outputs, not hand-written rows.
        </p>
        <div className="hstack">
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => void run('seed', async () => {
              const { seeded } = await api.seedSampleData(true);
              return `Seeded ${seeded.created} transactions, merged ${seeded.duplicates} duplicates, rejected ${seeded.rejected} non-transactions.`;
            })}
          >
            Load sample data
          </button>
          <button
            className="btn btn-danger"
            disabled={busy !== null}
            onClick={() => void run('clear', async () => {
              const { removed } = await api.clearSampleData();
              return `Removed ${removed} sample transactions.`;
            })}
          >
            Remove sample data
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Recent sync runs</h2>
          <button className="btn btn-sm" onClick={onRefresh}>Refresh</button>
        </div>
        {status.recentRuns.length === 0 ? (
          <p className="muted small">No sync has run yet.</p>
        ) : (
          <table className="cat-table">
            <thead>
              <tr>
                <th>Started</th><th>Kind</th><th>Status</th>
                <th className="num">Listed</th><th className="num">New</th><th className="num">Dupes</th><th className="num">Failed</th>
              </tr>
            </thead>
            <tbody>
              {status.recentRuns.map((run_) => (
                <tr key={run_.id}>
                  <td>{relativeTime(run_.startedAt)}</td>
                  <td className="mono">{run_.kind}</td>
                  <td>
                    {run_.status}
                    {run_.errorMessage && <div className="muted small">{run_.errorMessage}</div>}
                  </td>
                  <td className="num">{run_.listed}</td>
                  <td className="num">{run_.created}</td>
                  <td className="num">{run_.duplicates}</td>
                  <td className="num">{run_.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Parse failures</h2>
          <span className="card-note">content-free telemetry</span>
        </div>
        <p className="muted small">
          Only the sender domain and the shape of the subject line are recorded — never the subject or the body.
          A domain climbing this list is the signal that its template needs fixing in the rules pack.
        </p>
        {failures === null || failures.failures.length === 0 ? (
          <p className="muted small">No parse failures recorded.</p>
        ) : (
          <table className="cat-table">
            <thead><tr><th>Sender domain</th><th className="num">Failures</th><th>Last stage</th></tr></thead>
            <tbody>
              {failures.failures.map((f) => (
                <tr key={f.senderDomain}>
                  <td className="mono">{f.senderDomain}</td>
                  <td className="num">{f.count}</td>
                  <td className="mono">{f.lastStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Engine</h2>
        </div>
        <dl className="field-grid">
          <dt>Parser version</dt><dd className="mono">{status.parserVersion}</dd>
          <dt>Rules pack</dt><dd className="mono">{status.rulesPackVersion}</dd>
          <dt>Sync window</dt><dd>{status.windowDays} days</dd>
          <dt>Background sync</dt><dd>{status.schedulerMinutes > 0 ? `every ${status.schedulerMinutes} min` : 'manual only'}</dd>
          <dt>Remote LLM (L4)</dt><dd>{status.remoteLlmEnabled ? 'enabled (opt-in)' : 'off'}</dd>
        </dl>
        <button
          className="btn btn-sm"
          style={{ marginTop: 12 }}
          disabled={busy !== null}
          onClick={() => void run('rules', async () => {
            const result = await api.reloadRules();
            return `Rules pack ${result.version} reloaded: ${result.senders} senders, ${result.merchants} merchants.`;
          })}
        >
          Reload rules pack
        </button>
      </section>
    </div>
  );
}
