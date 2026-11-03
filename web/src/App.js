import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
const THEME_KEY = 'expense-tracker-theme';
function useTheme() {
    const [theme, setTheme] = useState(() => {
        try {
            const stored = localStorage.getItem(THEME_KEY);
            if (stored === 'light' || stored === 'dark' || stored === 'system')
                return stored;
        }
        catch {
            /* private mode or blocked storage */
        }
        return 'system';
    });
    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'system')
            root.removeAttribute('data-theme');
        else
            root.setAttribute('data-theme', theme);
        try {
            localStorage.setItem(THEME_KEY, theme);
        }
        catch {
            /* non-fatal */
        }
    }, [theme]);
    return [theme, setTheme];
}
export function App() {
    const [tab, setTab] = useState('dashboard');
    const [theme, setTheme] = useTheme();
    const [month, setMonth] = useState(null);
    const [currency, setCurrency] = useState(null);
    const [categoryFilter, setCategoryFilter] = useState(null);
    const [search, setSearch] = useState('');
    const [reviewOnly, setReviewOnly] = useState(false);
    const [summary, setSummary] = useState(null);
    const [categories, setCategories] = useState([]);
    const [transactions, setTransactions] = useState(null);
    const [syncStatus, setSyncStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [txnLoading, setTxnLoading] = useState(false);
    const [error, setError] = useState(null);
    const [statusError, setStatusError] = useState(null);
    const [toast, setToast] = useState(null);
    const [selected, setSelected] = useState(null);
    const [dataVersion, setDataVersion] = useState(0);
    const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);
    // One-time: flag the OAuth round trip result.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('connected') === '1') {
            setToast({ message: `Gmail connected${params.get('account') ? ` as ${params.get('account')}` : ''}.`, undoToken: null });
            window.history.replaceState({}, '', window.location.pathname);
        }
        else if (params.get('connected') === '0') {
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
            if (cancelled)
                return;
            setSummary(data);
            setError(null);
            if (month === null)
                setMonth(data.month);
            if (currency === null)
                setCurrency(data.currency);
        })
            .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [month, currency, dataVersion]);
    useEffect(() => {
        if (month === null)
            return;
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
        if (!transactions)
            return null;
        return currency ? transactions.filter((t) => t.currencyCode === currency || search.trim() !== '') : transactions;
    }, [transactions, currency, search]);
    const undo = async () => {
        if (!toast?.undoToken)
            return;
        try {
            const result = await api.undoRecategorize(toast.undoToken);
            setToast({ message: `Undone — ${result.restored} transactions restored.`, undoToken: null });
            refreshData();
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
    };
    useEffect(() => {
        if (!toast)
            return;
        const timer = setTimeout(() => setToast(null), toast.undoToken ? 9000 : 4500);
        return () => clearTimeout(timer);
    }, [toast]);
    const seedSample = async () => {
        try {
            const { seeded } = await api.seedSampleData(false);
            setToast({ message: `Loaded ${seeded.created} sample transactions.`, undoToken: null });
            refreshData();
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
    };
    return (_jsxs("div", { className: "app", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "brand", children: [_jsx("h1", { children: "Expenses" }), _jsx("span", { className: "brand-sub", children: "from Gmail" })] }), _jsx("nav", { className: "tabs", role: "tablist", "aria-label": "Sections", children: ['dashboard', 'transactions', 'lab', 'settings'].map((key) => (_jsx("button", { className: "tab", role: "tab", "aria-selected": tab === key, onClick: () => setTab(key), children: key === 'lab' ? 'Parser lab' : key[0].toUpperCase() + key.slice(1) }, key))) }), _jsxs("select", { className: "control", value: theme, onChange: (e) => setTheme(e.target.value), "aria-label": "Colour theme", children: [_jsx("option", { value: "system", children: "System theme" }), _jsx("option", { value: "light", children: "Light" }), _jsx("option", { value: "dark", children: "Dark" })] })] }), _jsxs("main", { className: "main", children: [error && _jsx(Banner, { kind: "error", onDismiss: () => setError(null), children: error }), syncStatus?.connection.configured === false && tab === 'dashboard' && hasAnyData && (_jsxs(Banner, { kind: "info", children: ["Gmail is not configured, so this is sample data. Add Google credentials in ", _jsx("code", { className: "mono", children: ".env" }), ' ', "to ingest your real mail \u2014 see ", _jsx("button", { className: "btn btn-sm", onClick: () => setTab('settings'), children: "Settings" }), "."] })), tab === 'dashboard' && (_jsx(_Fragment, { children: loading && !summary ? (_jsx(DashboardSkeleton, {})) : !summary || !hasAnyData ? (_jsx("div", { className: "card", children: _jsx(EmptyState, { title: "No transactions yet", message: "Load the bundled sample data to see the dashboard working end to end, or connect Gmail to ingest your real transaction emails.", actions: _jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-primary", onClick: () => void seedSample(), children: "Load sample data" }), _jsx("button", { className: "btn", onClick: () => setTab('settings'), children: "Connect Gmail" })] }) }) })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "filters", children: [_jsx("select", { className: "control", value: month ?? '', onChange: (e) => { setMonth(e.target.value); setCategoryFilter(null); }, "aria-label": "Month", children: summary.availableMonths.map((m) => (_jsx("option", { value: m, children: formatMonth(m) }, m))) }), _jsx("select", { className: "control", value: currency ?? '', onChange: (e) => setCurrency(e.target.value), "aria-label": "Currency", children: summary.availableCurrencies.map((c) => (_jsx("option", { value: c, children: c }, c))) }), summary.availableCurrencies.length > 1 && (_jsx("span", { className: "muted small", children: "Amounts are kept in the currency they were charged in \u2014 never converted on write." }))] }), _jsxs("div", { className: "grid", children: [_jsxs("div", { className: "grid grid-stats", children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "stat-label", children: "Total spend" }), _jsx("div", { className: "stat-value", children: formatMoney(summary.totalSpentMinor, summary.currency) }), _jsx("div", { className: "stat-sub", children: summary.changeVsPreviousMinor === 0 ? ('Same as last month') : (_jsxs("span", { className: summary.changeVsPreviousMinor > 0 ? 'delta-up' : 'delta-down', children: [summary.changeVsPreviousMinor > 0 ? '▲' : '▼', ' ', formatMoney(Math.abs(summary.changeVsPreviousMinor), summary.currency), " vs", ' ', formatMonth(summary.previousMonth.month)] })) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "stat-label", children: "Transactions" }), _jsx("div", { className: "stat-value", children: summary.transactionCount }), _jsxs("div", { className: "stat-sub", children: [summary.excludedCount, " excluded (transfers, income)"] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "stat-label", children: "Income received" }), _jsx("div", { className: "stat-value", children: formatMoney(summary.totalIncomeMinor, summary.currency) }), _jsx("div", { className: "stat-sub", children: "Kept out of spend totals" })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "stat-label", children: "Needs review" }), _jsx("div", { className: "stat-value", children: summary.needsReviewCount }), _jsx("div", { className: "stat-sub", children: summary.needsReviewCount > 0 ? (_jsx("button", { className: "btn btn-sm", onClick: () => { setReviewOnly(true); setTab('transactions'); }, children: "Review low-confidence" })) : ('Everything parsed confidently') })] })] }), _jsxs("div", { className: "grid grid-charts", children: [_jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Spend by category" }), categoryFilter && (_jsx("button", { className: "btn btn-sm", onClick: () => setCategoryFilter(null), children: "Clear filter" }))] }), _jsx(DonutChart, { wedges: wedges, totalMinor: summary.totalSpentMinor, currency: summary.currency, activeKey: categoryFilter, onSelect: (key) => setCategoryFilter(key) }), _jsx("div", { style: { marginTop: 14 }, children: _jsx(CategoryTable, { stats: summary.byCategory, currency: summary.currency, activeKey: categoryFilter, onSelect: setCategoryFilter }) })] }), _jsxs("div", { className: "vstack", style: { gap: 16 }, children: [_jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsxs("h2", { className: "card-title", children: ["Daily spend \u2014 ", formatMonth(summary.month)] }), _jsx("span", { className: "card-note", children: summary.currency })] }), _jsx(DailySpendChart, { days: summary.byDay, month: summary.month, currency: summary.currency })] }), _jsxs("section", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("h2", { className: "card-title", children: "Top merchants" }) }), summary.topMerchants.length === 0 ? (_jsx("p", { className: "muted small", children: "No merchant activity this month." })) : (_jsxs("table", { className: "cat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Merchant" }), _jsx("th", { className: "num", children: "Spent" }), _jsx("th", { className: "num", children: "Txns" })] }) }), _jsx("tbody", { children: summary.topMerchants.map((m) => (_jsxs("tr", { onClick: () => { setSearch(m.merchant); setTab('transactions'); }, children: [_jsx("td", { children: m.merchant }), _jsx("td", { className: "num", children: formatMoney(m.totalMinor, summary.currency) }), _jsx("td", { className: "num muted", children: m.count })] }, m.normalized))) })] }))] })] })] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsxs("h2", { className: "card-title", children: ["Recent transactions", categoryFilter && ` — ${categories.find((c) => c.key === categoryFilter)?.name ?? categoryFilter}`] }), _jsx("button", { className: "btn btn-sm", onClick: () => setTab('transactions'), children: "See all" })] }), txnLoading && !visibleTransactions ? (_jsx(LoadingCard, { lines: 5, height: 18 })) : (visibleTransactions?.length ?? 0) === 0 ? (_jsx("p", { className: "muted small", children: "No transactions match this view." })) : (_jsx(TransactionList, { transactions: (visibleTransactions ?? []).slice(0, 8), categories: categories, currency: currency, onSelect: setSelected }))] })] })] })) })), tab === 'transactions' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "filters", children: [_jsx("input", { className: "control", placeholder: "Search merchant or subject\u2026", value: search, onChange: (e) => setSearch(e.target.value), style: { minWidth: 240 } }), _jsx("select", { className: "control", value: month ?? '', onChange: (e) => setMonth(e.target.value), "aria-label": "Month", children: (summary?.availableMonths ?? []).map((m) => (_jsx("option", { value: m, children: formatMonth(m) }, m))) }), _jsxs("select", { className: "control", value: categoryFilter ?? '', onChange: (e) => setCategoryFilter(e.target.value || null), "aria-label": "Category", children: [_jsx("option", { value: "", children: "All categories" }), categories.map((c) => (_jsx("option", { value: c.key, children: c.name }, c.key)))] }), _jsxs("label", { className: "hstack small", children: [_jsx("input", { type: "checkbox", checked: reviewOnly, onChange: (e) => setReviewOnly(e.target.checked) }), "Needs review only"] }), (search || categoryFilter || reviewOnly) && (_jsx("button", { className: "btn btn-sm", onClick: () => { setSearch(''); setCategoryFilter(null); setReviewOnly(false); }, children: "Clear" }))] }), _jsx("section", { className: "card", children: txnLoading && !visibleTransactions ? (_jsx(LoadingCard, { lines: 8, height: 20 })) : !visibleTransactions ? (_jsx(ErrorState, { message: "Could not load transactions.", onRetry: refreshData })) : visibleTransactions.length === 0 ? (_jsx(EmptyState, { title: "Nothing here", message: search || categoryFilter || reviewOnly
                                        ? 'No transaction matches these filters. Try clearing them.'
                                        : 'No transactions in this month yet.', actions: (search || categoryFilter || reviewOnly) ? (_jsx("button", { className: "btn", onClick: () => { setSearch(''); setCategoryFilter(null); setReviewOnly(false); }, children: "Clear filters" })) : (_jsx("button", { className: "btn btn-primary", onClick: () => void seedSample(), children: "Load sample data" })) })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "card-header", children: [_jsxs("h2", { className: "card-title", children: [visibleTransactions.length, " transactions"] }), _jsx("span", { className: "card-note", children: "Click a row for the full parse provenance" })] }), _jsx(TransactionList, { transactions: visibleTransactions, categories: categories, currency: currency, onSelect: setSelected })] })) })] })), tab === 'lab' && _jsx(ParserLab, {}), tab === 'settings' && (_jsx(SettingsPanel, { status: syncStatus, statusError: statusError, onRefresh: loadStatus, onDataChanged: refreshData }))] }), selected && (_jsx(TransactionDrawer, { transaction: selected, categories: categories, onClose: () => setSelected(null), onChanged: (message, undoToken) => {
                    setToast({ message, undoToken });
                    refreshData();
                } })), toast && (_jsxs("div", { className: "toast", role: "status", children: [_jsx("span", { children: toast.message }), toast.undoToken && (_jsx("button", { className: "btn btn-sm", onClick: () => void undo(), children: "Undo" })), _jsx("button", { className: "btn btn-sm", onClick: () => setToast(null), "aria-label": "Dismiss", children: "\u2715" })] }))] }));
}
