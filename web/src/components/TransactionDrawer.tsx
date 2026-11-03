import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDate, formatMoney, formatPercent } from '../lib/format';
import { colorVarFor } from '../lib/palette';
import type { Category, DuplicateLink, Transaction } from '../types';
import { Banner, LoadingCard } from './States';

interface Props {
  transaction: Transaction;
  categories: Category[];
  onClose: () => void;
  onChanged: (message: string, undoToken: string | null) => void;
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.8) return 'var(--good)';
  if (confidence >= 0.6) return 'var(--warning)';
  return 'var(--critical)';
}

export function TransactionDrawer({ transaction, categories, onClose, onChanged }: Props) {
  const [current, setCurrent] = useState<Transaction>(transaction);
  const [duplicates, setDuplicates] = useState<DuplicateLink[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCurrent(transaction);
    setDuplicates(null);
    api
      .transaction(transaction.id)
      .then((data) => {
        if (cancelled) return;
        setCurrent(data.transaction);
        setDuplicates(data.duplicates);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [transaction]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changeCategory = async (categoryKey: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.recategorize(current.id, categoryKey);
      setCurrent(result.transaction);
      const name = categories.find((c) => c.key === categoryKey)?.name ?? categoryKey;
      onChanged(
        result.retroactivelyUpdated > 0
          ? `Recategorised ${result.retroactivelyUpdated} past ${result.retroactivelyUpdated === 1 ? 'transaction' : 'transactions'} from ${current.merchantDisplay} to ${name}`
          : `Moved to ${name}`,
        result.undoToken,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleExcluded = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await api.updateTransaction(current.id, {
        isExcludedFromTotals: !current.isExcludedFromTotals,
      });
      setCurrent(result.transaction);
      onChanged(result.transaction.isExcludedFromTotals ? 'Excluded from totals' : 'Included in totals', null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const gmailUrl = `https://mail.google.com/mail/u/0/#all/${current.gmailMessageId}`;
  const isSample = current.source === 'sample';

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Transaction detail">
        <div className="drawer-header">
          <div>
            <h2>{current.merchantDisplay}</h2>
            <div className="muted small">{formatDate(current.occurredAt, 'long')}</div>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

        <div>
          <div className={`drawer-amount${current.isCredit ? ' credit' : ''}`}>
            {current.isCredit ? '+' : ''}
            {formatMoney(current.amountMinor, current.currencyCode)}
          </div>
          <div className="muted small">
            {current.isCredit ? 'Credit / refund' : 'Debit'}
            {current.isExcludedFromTotals && ' · excluded from spend totals'}
          </div>
        </div>

        <div>
          <div className="card-header">
            <h3 className="card-title">Category</h3>
            <span className="card-note">{current.categorySource ?? 'unset'}</span>
          </div>
          <div className="hstack">
            <span className="swatch" style={{ background: colorVarFor(current.categoryKey) }} />
            <select
              className="control"
              value={current.categoryKey ?? ''}
              disabled={saving}
              onChange={(e) => void changeCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
            <button className="btn btn-sm" onClick={() => void toggleExcluded()} disabled={saving}>
              {current.isExcludedFromTotals ? 'Include in totals' : 'Exclude from totals'}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Changing this applies to every past transaction from {current.merchantDisplay} and is remembered
            permanently.
          </p>
        </div>

        <div>
          <div className="card-header">
            <h3 className="card-title">Extraction confidence</h3>
            <span className="card-note">{formatPercent(current.confidence)}</span>
          </div>
          <div className="meter">
            <div style={{ width: `${Math.round(current.confidence * 100)}%`, background: confidenceTone(current.confidence) }} />
          </div>
          {current.confidenceReasons.length > 0 && (
            <ul className="muted small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {current.confidenceReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </div>

        <div>
          <h3 className="card-title" style={{ marginBottom: 10 }}>Provenance</h3>
          <dl className="field-grid">
            <dt>Method</dt><dd className="mono">{current.extractionMethod}</dd>
            <dt>Parser version</dt><dd className="mono">{current.parserVersion}</dd>
            <dt>From</dt><dd className="mono">{current.senderAddress}</dd>
            {current.subject && (<><dt>Subject</dt><dd>{current.subject}</dd></>)}
            <dt>Raw descriptor</dt><dd className="mono">{current.merchantRaw}</dd>
            <dt>Normalised</dt><dd className="mono">{current.merchantNormalized}</dd>
            {current.accountLast4 && (<><dt>Card / account</dt><dd className="mono">•••• {current.accountLast4} {current.accountLabel ?? ''}</dd></>)}
            <dt>Message id</dt><dd className="mono">{current.gmailMessageId}</dd>
            <dt>Dedupe key</dt><dd className="mono">{current.dedupeKey.slice(0, 16)}…</dd>
          </dl>
          <div className="hstack" style={{ marginTop: 12 }}>
            {isSample ? (
              <span className="badge">Sample data — no source email</span>
            ) : (
              <a className="btn btn-sm" href={gmailUrl} target="_blank" rel="noreferrer">
                View source email in Gmail ↗
              </a>
            )}
          </div>
        </div>

        <div>
          <h3 className="card-title" style={{ marginBottom: 10 }}>Duplicate emails merged</h3>
          {duplicates === null ? (
            <LoadingCard lines={2} height={12} />
          ) : duplicates.length === 0 ? (
            <p className="muted small">No other email reported this transaction.</p>
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {duplicates.map((dup) => (
                <li key={dup.duplicateMessageId}>
                  <span className="mono">{dup.duplicateSender}</span> — matched by {dup.matchKind}{' '}
                  ({formatPercent(dup.similarity)} similar)
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
