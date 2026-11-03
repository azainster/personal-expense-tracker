import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { FixtureSummary, ParseTrace } from '../types';
import { Banner, LoadingCard } from './States';

/**
 * "Debug screen dumping raw parsed text. Build this on day one. You will live in it."
 * Shows the stripped text the pipeline saw, which cascade stage answered, and every scored
 * amount candidate with the reason for each point.
 */
export function ParserLab() {
  const [fixtures, setFixtures] = useState<FixtureSummary[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [trace, setTrace] = useState<ParseTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState({ from: '', subject: '', text: '' });

  useEffect(() => {
    api
      .fixtures()
      .then((data) => {
        setFixtures(data.fixtures);
        const first = data.fixtures[0];
        if (first) {
          setSelected(first.id);
          void loadFixture(first.id);
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  async function loadFixture(id: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setTrace(await api.parseFixture(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }

  async function parsePasted(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setTrace(await api.parseRaw({ from: pasted.from, subject: pasted.subject, text: pasted.text }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const result = trace?.result;
  const winner = result?.status === 'parsed' ? result.transaction.amountMinor : null;

  return (
    <div className="vstack" style={{ gap: 16 }}>
      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Parse a fixture</h2>
          <span className="card-note">{fixtures?.length ?? 0} bundled emails</span>
        </div>
        <div className="hstack">
          <select
            className="control"
            value={selected}
            style={{ minWidth: 280 }}
            onChange={(e) => {
              setSelected(e.target.value);
              void loadFixture(e.target.value);
            }}
          >
            {(fixtures ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.id} — expects {f.expected.status}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!selected || loading} onClick={() => void loadFixture(selected)}>
            Re-parse
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Or paste an email</h2>
        </div>
        <div className="vstack">
          <input
            className="control"
            placeholder="From: Bank Alerts <alerts@example.com>"
            value={pasted.from}
            onChange={(e) => setPasted({ ...pasted, from: e.target.value })}
          />
          <input
            className="control"
            placeholder="Subject"
            value={pasted.subject}
            onChange={(e) => setPasted({ ...pasted, subject: e.target.value })}
          />
          <textarea
            className="control"
            rows={5}
            placeholder="Paste the email body (plain text or HTML)"
            value={pasted.text}
            onChange={(e) => setPasted({ ...pasted, text: e.target.value })}
          />
          <div>
            <button
              className="btn btn-primary"
              disabled={loading || pasted.from.trim() === '' || pasted.text.trim() === ''}
              onClick={() => void parsePasted()}
            >
              Parse it
            </button>
          </div>
        </div>
      </section>

      {loading && <div className="card"><LoadingCard lines={5} /></div>}

      {!loading && trace && result && (
        <>
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Result</h2>
              <span className="card-note">
                parser {trace.parserVersion} · rules {trace.rulesPackVersion}
              </span>
            </div>

            <div className="stage-chain" style={{ marginBottom: 14 }}>
              {result.debug.stages.map((stage, i) => (
                <span key={i} className={`stage${/:(?!miss)[a-z0-9-]+\)/.test(stage) ? ' stage-hit' : ''}`}>
                  {stage}
                </span>
              ))}
            </div>

            {result.status === 'parsed' ? (
              <dl className="field-grid">
                <dt>Amount</dt>
                <dd><b>{formatMoney(result.transaction.amountMinor, result.transaction.currencyCode)}</b>{' '}
                  <span className="muted">({result.transaction.amountMinor} minor units)</span></dd>
                <dt>Merchant</dt>
                <dd>{result.transaction.merchantDisplay} <span className="muted mono">({result.transaction.merchantNormalized})</span></dd>
                <dt>Raw descriptor</dt><dd className="mono">{result.transaction.merchantRaw}</dd>
                <dt>Category</dt><dd>{result.transaction.categoryKey} <span className="muted">via {result.transaction.categorySource}</span></dd>
                <dt>Date</dt><dd>{new Date(result.transaction.occurredAt).toLocaleDateString()} <span className="muted">({result.debug.dateSource})</span></dd>
                <dt>Method</dt><dd className="mono">{result.transaction.extractionMethod}</dd>
                <dt>Confidence</dt><dd>{(result.transaction.confidence * 100).toFixed(1)}%</dd>
                <dt>Credit?</dt><dd>{result.transaction.isCredit ? 'yes' : 'no'}</dd>
                <dt>Dedupe key</dt><dd className="mono">{result.transaction.dedupeKey}</dd>
              </dl>
            ) : (
              <Banner kind="warn">
                <b>Rejected at {result.stageReached}</b> — {result.reason}
                <div className="muted small" style={{ marginTop: 4 }}>
                  Telemetry recorded: domain {result.senderDomain}, subject shape{' '}
                  <span className="mono">{result.subjectShape}</span>
                </div>
              </Banner>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Scored amount candidates</h2>
              <span className="card-note">argmax wins</span>
            </div>
            {result.debug.amountCandidates.length === 0 ? (
              <p className="muted small">No money-like span was found in this email.</p>
            ) : (
              <table className="cand-table">
                <thead>
                  <tr><th>Score</th><th>Amount</th><th>Span</th><th>Signals</th></tr>
                </thead>
                <tbody>
                  {result.debug.amountCandidates.map((c, i) => (
                    <tr key={i} className={winner !== null && c.minorUnits === winner ? 'winner' : ''}>
                      <td className={c.score >= 0 ? 'score-pos' : 'score-neg'}><b>{c.score.toFixed(2)}</b></td>
                      <td className="mono">{formatMoney(c.minorUnits, c.currency)}</td>
                      <td className="mono">{c.raw}</td>
                      <td className="muted">{c.reasons.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Text the parser actually saw</h2>
              <span className="card-note">{result.debug.textLength} chars after stripping</span>
            </div>
            <div className="code-block">{result.debug.cleanedText || '(empty)'}</div>
          </section>
        </>
      )}
    </div>
  );
}
