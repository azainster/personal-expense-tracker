import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './lib/api';
import { formatMoney, formatMonth } from './lib/format';
import { buildWedges } from './lib/palette';
import { DonutChart } from './components/DonutChart';
import { DailySpendChart } from './components/DailySpendChart';
import { CategoryTable } from './components/CategoryTable';
import { TransactionList } from './components/TransactionList';
import { TransactionDrawer } from './components/TransactionDrawer';
import { SettingsPanel } from './components/SettingsPanel';
import { ParserLab } from './components/ParserLab';
import { Banner, DashboardSkeleton, EmptyState, ErrorState, LoadingCard } from './components/States';
import type { Category, Summary, SyncStatus, Transaction } from './types';

type Tab = 'dashboard' | 'transactions' | 'lab' | 'settings';
type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'expense-tracker-theme';

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {
      /* private mode or blocked storage */
    }
    return 'system';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* non-fatal */
    }
  }, [theme]);

  return [theme, setTheme];
}

interface Toast {
  message: string;
  undoToken: string | null;
}

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [theme, setTheme] = useTheme();

  const [month, setMonth] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [txnLoading, setTxnLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  // I use one version counter to make every screen refresh after an edit or sync completes.
  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

  // One-time: flag the OAuth round trip result.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === '1') {
      setToast({ message: `Gmail connected${params.get('account') ? ` as ${params.get('account')}` : ''}.`, undoToken: null });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('connected') === '0') {
      setError(`Gmail connection failed: ${params.get('error') ?? 'unknown error'}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    api.categories().then((data) => setCategories(data.categories)).catch(() => setCategories([]));
  }, [dataVersion]);

  const loadStatus = useCallback(() => {
    api
      .syncStatus()
      .then((data) => {
        setSyncStatus(data);
        setStatusError(null);
      })
      .catch((err) => setStatusError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  useEffect(() => loadStatus(), [loadStatus, dataVersion]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .summary(month ?? undefined, currency ?? undefined)
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setError(null);
        if (month === null) setMonth(data.month);
        if (currency === null) setCurrency(data.currency);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, currency, dataVersion]);

  useEffect(() => {
    if (month === null) return;
    let cancelled = false;
    setTxnLoading(true);
    api
      .transactions({
        month,
        category: categoryFilter ?? undefined,
        search: search.trim() || undefined,
        needsReview: reviewOnly,
        includeExcluded: true,
        limit: 250,
      })
      .then((data) => !cancelled && setTransactions(data.transactions))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => !cancelled && setTxnLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, categoryFilter, search, reviewOnly, dataVersion]);

  const wedges = useMemo(() => buildWedges(summary?.byCategory ?? []), [summary]);
  const hasAnyData = (summary?.availableMonths.length ?? 0) > 0;

  const visibleTransactions = useMemo(() => {
    if (!transactions) return null;
    return currency ? transactions.filter((t) => t.currencyCode === currency || search.trim() !== '') : transactions;
  }, [transactions, currency, search]);

  const undo = async (): Promise<void> => {
    if (!toast?.undoToken) return;
    try {
      const result = await api.undoRecategorize(toast.undoToken);
      setToast({ message: `Undone — ${result.restored} transactions restored.`, undoToken: null });
      refreshData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undoToken ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const seedSample = async (): Promise<void> => {
    try {
      const { seeded } = await api.seedSampleData(false);
      setToast({ message: `Loaded ${seeded.created} sample transactions.`, undoToken: null });
      refreshData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Expenses</h1>
          <span className="brand-sub">from Gmail</span>
        </div>

        <nav className="tabs" role="tablist" aria-label="Sections">
          {(['dashboard', 'transactions', 'lab', 'settings'] as Tab[]).map((key) => (
            <button
              key={key}
              className="tab"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {key === 'lab' ? 'Parser lab' : key[0]!.toUpperCase() + key.slice(1)}
            </button>
          ))}
        </nav>

        <select
          className="control"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          aria-label="Colour theme"
        >
          <option value="system">System theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </header>

      <main className="main">
        {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
        {syncStatus?.connection.configured === false && tab === 'dashboard' && hasAnyData && (
          <Banner kind="info">
            Gmail is not configured, so this is sample data. Add Google credentials in <code className="mono">.env</code>{' '}
            to ingest your real mail — see <button className="btn btn-sm" onClick={() => setTab('settings')}>Settings</button>.
          </Banner>
        )}

        {tab === 'dashboard' && (
          <>
            {loading && !summary ? (
              <DashboardSkeleton />
            ) : !summary || !hasAnyData ? (
              <div className="card">
                <EmptyState
                  title="No transactions yet"
                  message="Load the bundled sample data to see the dashboard working end to end, or connect Gmail to ingest your real transaction emails."
                  actions={
                    <>
                      <button className="btn btn-primary" onClick={() => void seedSample()}>Load sample data</button>
                      <button className="btn" onClick={() => setTab('settings')}>Connect Gmail</button>
                    </>
                  }
                />
              </div>
            ) : (
              <>
                <div className="filters">
                  <select
                    className="control"
                    value={month ?? ''}
                    onChange={(e) => { setMonth(e.target.value); setCategoryFilter(null); }}
                    aria-label="Month"
                  >
                    {summary.availableMonths.map((m) => (
                      <option key={m} value={m}>{formatMonth(m)}</option>
                    ))}
                  </select>
                  <select
                    className="control"
                    value={currency ?? ''}
                    onChange={(e) => setCurrency(e.target.value)}
                    aria-label="Currency"
                  >
                    {summary.availableCurrencies.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {summary.availableCurrencies.length > 1 && (
                    <span className="muted small">
                      Amounts are kept in the currency they were charged in — never converted on write.
                    </span>
                  )}
                </div>

                <div className="grid">
                  <div className="grid grid-stats">
                    <div className="card">
                      <div className="stat-label">Total spend</div>
                      <div className="stat-value">{formatMoney(summary.totalSpentMinor, summary.currency)}</div>
                      <div className="stat-sub">
                        {summary.changeVsPreviousMinor === 0 ? (
                          'Same as last month'
                        ) : (
                          <span className={summary.changeVsPreviousMinor > 0 ? 'delta-up' : 'delta-down'}>
                            {summary.changeVsPreviousMinor > 0 ? '▲' : '▼'}{' '}
                            {formatMoney(Math.abs(summary.changeVsPreviousMinor), summary.currency)} vs{' '}
                            {formatMonth(summary.previousMonth.month)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="card">
                      <div className="stat-label">Transactions</div>
                      <div className="stat-value">{summary.transactionCount}</div>
                      <div className="stat-sub">{summary.excludedCount} excluded (transfers, income)</div>
                    </div>
                    <div className="card">
                      <div className="stat-label">Income received</div>
                      <div className="stat-value">{formatMoney(summary.totalIncomeMinor, summary.currency)}</div>
                      <div className="stat-sub">Kept out of spend totals</div>
                    </div>
                    <div className="card">
                      <div className="stat-label">Needs review</div>
                      <div className="stat-value">{summary.needsReviewCount}</div>
                      <div className="stat-sub">
                        {summary.needsReviewCount > 0 ? (
                          <button
                            className="btn btn-sm"
                            onClick={() => { setReviewOnly(true); setTab('transactions'); }}
                          >
                            Review low-confidence
                          </button>
                        ) : (
                          'Everything parsed confidently'
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-charts">
                    <section className="card">
                      <div className="card-header">
                        <h2 className="card-title">Spend by category</h2>
                        {categoryFilter && (
                          <button className="btn btn-sm" onClick={() => setCategoryFilter(null)}>Clear filter</button>
                        )}
                      </div>
                      <DonutChart
                        wedges={wedges}
                        totalMinor={summary.totalSpentMinor}
                        currency={summary.currency}
                        activeKey={categoryFilter}
                        onSelect={(key) => setCategoryFilter(key)}
                      />
                      <div style={{ marginTop: 14 }}>
                        <CategoryTable
                          stats={summary.byCategory}
                          currency={summary.currency}
                          activeKey={categoryFilter}
                          onSelect={setCategoryFilter}
                        />
                      </div>
                    </section>

                    <div className="vstack" style={{ gap: 16 }}>
                      <section className="card">
                        <div className="card-header">
                          <h2 className="card-title">Daily spend — {formatMonth(summary.month)}</h2>
                          <span className="card-note">{summary.currency}</span>
                        </div>
                        <DailySpendChart days={summary.byDay} month={summary.month} currency={summary.currency} />
                      </section>

                      <section className="card">
                        <div className="card-header">
                          <h2 className="card-title">Top merchants</h2>
                        </div>
                        {summary.topMerchants.length === 0 ? (
                          <p className="muted small">No merchant activity this month.</p>
                        ) : (
                          <table className="cat-table">
                            <thead>
                              <tr><th>Merchant</th><th className="num">Spent</th><th className="num">Txns</th></tr>
                            </thead>
                            <tbody>
                              {summary.topMerchants.map((m) => (
                                <tr key={m.normalized} onClick={() => { setSearch(m.merchant); setTab('transactions'); }}>
                                  <td>{m.merchant}</td>
                                  <td className="num">{formatMoney(m.totalMinor, summary.currency)}</td>
                                  <td className="num muted">{m.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </section>
                    </div>
                  </div>

                  <section className="card">
                    <div className="card-header">
                      <h2 className="card-title">
                        Recent transactions
                        {categoryFilter && ` — ${categories.find((c) => c.key === categoryFilter)?.name ?? categoryFilter}`}
                      </h2>
                      <button className="btn btn-sm" onClick={() => setTab('transactions')}>See all</button>
                    </div>
                    {txnLoading && !visibleTransactions ? (
                      <LoadingCard lines={5} height={18} />
                    ) : (visibleTransactions?.length ?? 0) === 0 ? (
                      <p className="muted small">No transactions match this view.</p>
                    ) : (
                      <TransactionList
                        transactions={(visibleTransactions ?? []).slice(0, 8)}
                        categories={categories}
                        currency={currency}
                        onSelect={setSelected}
                      />
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'transactions' && (
          <>
            <div className="filters">
              <input
                className="control"
                placeholder="Search merchant or subject…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 240 }}
              />
              <select className="control" value={month ?? ''} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                {(summary?.availableMonths ?? []).map((m) => (
                  <option key={m} value={m}>{formatMonth(m)}</option>
                ))}
              </select>
              <select
                className="control"
                value={categoryFilter ?? ''}
                onChange={(e) => setCategoryFilter(e.target.value || null)}
                aria-label="Category"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
              <label className="hstack small">
                <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
                Needs review only
              </label>
              {(search || categoryFilter || reviewOnly) && (
                <button
                  className="btn btn-sm"
                  onClick={() => { setSearch(''); setCategoryFilter(null); setReviewOnly(false); }}
                >
                  Clear
                </button>
              )}
            </div>

            <section className="card">
              {txnLoading && !visibleTransactions ? (
                <LoadingCard lines={8} height={20} />
              ) : !visibleTransactions ? (
                <ErrorState message="Could not load transactions." onRetry={refreshData} />
              ) : visibleTransactions.length === 0 ? (
                <EmptyState
                  title="Nothing here"
                  message={
                    search || categoryFilter || reviewOnly
                      ? 'No transaction matches these filters. Try clearing them.'
                      : 'No transactions in this month yet.'
                  }
                  actions={
                    (search || categoryFilter || reviewOnly) ? (
                      <button className="btn" onClick={() => { setSearch(''); setCategoryFilter(null); setReviewOnly(false); }}>
                        Clear filters
                      </button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => void seedSample()}>Load sample data</button>
                    )
                  }
                />
              ) : (
                <>
                  <div className="card-header">
                    <h2 className="card-title">{visibleTransactions.length} transactions</h2>
                    <span className="card-note">Click a row for the full parse provenance</span>
                  </div>
                  <TransactionList
                    transactions={visibleTransactions}
                    categories={categories}
                    currency={currency}
                    onSelect={setSelected}
                  />
                </>
              )}
            </section>
          </>
        )}

        {tab === 'lab' && <ParserLab />}

        {tab === 'settings' && (
          <SettingsPanel
            status={syncStatus}
            statusError={statusError}
            onRefresh={loadStatus}
            onDataChanged={refreshData}
          />
        )}
      </main>

      {selected && (
        <TransactionDrawer
          transaction={selected}
          categories={categories}
          onClose={() => setSelected(null)}
          onChanged={(message, undoToken) => {
            setToast({ message, undoToken });
            refreshData();
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undoToken && (
            <button className="btn btn-sm" onClick={() => void undo()}>Undo</button>
          )}
          <button className="btn btn-sm" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}
