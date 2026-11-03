import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDate, formatMoney, formatPercent } from '../lib/format';
import { colorVarFor } from '../lib/palette';
import { Banner, LoadingCard } from './States';
function confidenceTone(confidence) {
    if (confidence >= 0.8)
        return 'var(--good)';
    if (confidence >= 0.6)
        return 'var(--warning)';
    return 'var(--critical)';
}
export function TransactionDrawer({ transaction, categories, onClose, onChanged }) {
    const [current, setCurrent] = useState(transaction);
    const [duplicates, setDuplicates] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        setCurrent(transaction);
        setDuplicates(null);
        api
            .transaction(transaction.id)
            .then((data) => {
            if (cancelled)
                return;
            setCurrent(data.transaction);
            setDuplicates(data.duplicates);
        })
            .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)));
        return () => {
            cancelled = true;
        };
    }, [transaction]);
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    const changeCategory = async (categoryKey) => {
        setSaving(true);
        setError(null);
        try {
            const result = await api.recategorize(current.id, categoryKey);
            setCurrent(result.transaction);
            const name = categories.find((c) => c.key === categoryKey)?.name ?? categoryKey;
            onChanged(result.retroactivelyUpdated > 0
                ? `Recategorised ${result.retroactivelyUpdated} past ${result.retroactivelyUpdated === 1 ? 'transaction' : 'transactions'} from ${current.merchantDisplay} to ${name}`
                : `Moved to ${name}`, result.undoToken);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
        finally {
            setSaving(false);
        }
    };
    const toggleExcluded = async () => {
        setSaving(true);
        try {
            const result = await api.updateTransaction(current.id, {
                isExcludedFromTotals: !current.isExcludedFromTotals,
            });
            setCurrent(result.transaction);
            onChanged(result.transaction.isExcludedFromTotals ? 'Excluded from totals' : 'Included in totals', null);
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
        finally {
            setSaving(false);
        }
    };
    const gmailUrl = `https://mail.google.com/mail/u/0/#all/${current.gmailMessageId}`;
    const isSample = current.source === 'sample';
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "drawer-backdrop", onClick: onClose }), _jsxs("aside", { className: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Transaction detail", children: [_jsxs("div", { className: "drawer-header", children: [_jsxs("div", { children: [_jsx("h2", { children: current.merchantDisplay }), _jsx("div", { className: "muted small", children: formatDate(current.occurredAt, 'long') })] }), _jsx("button", { className: "btn btn-sm", onClick: onClose, "aria-label": "Close", children: "\u2715" })] }), error && _jsx(Banner, { kind: "error", onDismiss: () => setError(null), children: error }), _jsxs("div", { children: [_jsxs("div", { className: `drawer-amount${current.isCredit ? ' credit' : ''}`, children: [current.isCredit ? '+' : '', formatMoney(current.amountMinor, current.currencyCode)] }), _jsxs("div", { className: "muted small", children: [current.isCredit ? 'Credit / refund' : 'Debit', current.isExcludedFromTotals && ' · excluded from spend totals'] })] }), _jsxs("div", { children: [_jsxs("div", { className: "card-header", children: [_jsx("h3", { className: "card-title", children: "Category" }), _jsx("span", { className: "card-note", children: current.categorySource ?? 'unset' })] }), _jsxs("div", { className: "hstack", children: [_jsx("span", { className: "swatch", style: { background: colorVarFor(current.categoryKey) } }), _jsx("select", { className: "control", value: current.categoryKey ?? '', disabled: saving, onChange: (e) => void changeCategory(e.target.value), children: categories.map((c) => (_jsx("option", { value: c.key, children: c.name }, c.key))) }), _jsx("button", { className: "btn btn-sm", onClick: () => void toggleExcluded(), disabled: saving, children: current.isExcludedFromTotals ? 'Include in totals' : 'Exclude from totals' })] }), _jsxs("p", { className: "muted small", style: { marginTop: 8 }, children: ["Changing this applies to every past transaction from ", current.merchantDisplay, " and is remembered permanently."] })] }), _jsxs("div", { children: [_jsxs("div", { className: "card-header", children: [_jsx("h3", { className: "card-title", children: "Extraction confidence" }), _jsx("span", { className: "card-note", children: formatPercent(current.confidence) })] }), _jsx("div", { className: "meter", children: _jsx("div", { style: { width: `${Math.round(current.confidence * 100)}%`, background: confidenceTone(current.confidence) } }) }), current.confidenceReasons.length > 0 && (_jsx("ul", { className: "muted small", style: { margin: '8px 0 0', paddingLeft: 18 }, children: current.confidenceReasons.map((reason) => _jsx("li", { children: reason }, reason)) }))] }), _jsxs("div", { children: [_jsx("h3", { className: "card-title", style: { marginBottom: 10 }, children: "Provenance" }), _jsxs("dl", { className: "field-grid", children: [_jsx("dt", { children: "Method" }), _jsx("dd", { className: "mono", children: current.extractionMethod }), _jsx("dt", { children: "Parser version" }), _jsx("dd", { className: "mono", children: current.parserVersion }), _jsx("dt", { children: "From" }), _jsx("dd", { className: "mono", children: current.senderAddress }), current.subject && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Subject" }), _jsx("dd", { children: current.subject })] })), _jsx("dt", { children: "Raw descriptor" }), _jsx("dd", { className: "mono", children: current.merchantRaw }), _jsx("dt", { children: "Normalised" }), _jsx("dd", { className: "mono", children: current.merchantNormalized }), current.accountLast4 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Card / account" }), _jsxs("dd", { className: "mono", children: ["\u2022\u2022\u2022\u2022 ", current.accountLast4, " ", current.accountLabel ?? ''] })] })), _jsx("dt", { children: "Message id" }), _jsx("dd", { className: "mono", children: current.gmailMessageId }), _jsx("dt", { children: "Dedupe key" }), _jsxs("dd", { className: "mono", children: [current.dedupeKey.slice(0, 16), "\u2026"] })] }), _jsx("div", { className: "hstack", style: { marginTop: 12 }, children: isSample ? (_jsx("span", { className: "badge", children: "Sample data \u2014 no source email" })) : (_jsx("a", { className: "btn btn-sm", href: gmailUrl, target: "_blank", rel: "noreferrer", children: "View source email in Gmail \u2197" })) })] }), _jsxs("div", { children: [_jsx("h3", { className: "card-title", style: { marginBottom: 10 }, children: "Duplicate emails merged" }), duplicates === null ? (_jsx(LoadingCard, { lines: 2, height: 12 })) : duplicates.length === 0 ? (_jsx("p", { className: "muted small", children: "No other email reported this transaction." })) : (_jsx("ul", { className: "small", style: { margin: 0, paddingLeft: 18 }, children: duplicates.map((dup) => (_jsxs("li", { children: [_jsx("span", { className: "mono", children: dup.duplicateSender }), " \u2014 matched by ", dup.matchKind, ' ', "(", formatPercent(dup.similarity), " similar)"] }, dup.duplicateMessageId))) }))] })] })] }));
}
