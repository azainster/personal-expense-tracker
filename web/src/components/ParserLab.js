import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Banner, LoadingCard } from './States';
/**
 * "Debug screen dumping raw parsed text. Build this on day one. You will live in it."
 * Shows the stripped text the pipeline saw, which cascade stage answered, and every scored
 * amount candidate with the reason for each point.
 */
export function ParserLab() {
    const [fixtures, setFixtures] = useState(null);
    const [selected, setSelected] = useState('');
    const [trace, setTrace] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
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
    async function loadFixture(id) {
        setLoading(true);
        setError(null);
        try {
            setTrace(await api.parseFixture(id));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
            setTrace(null);
        }
        finally {
            setLoading(false);
        }
    }
    async function parsePasted() {
        setLoading(true);
        setError(null);
        try {
            setTrace(await api.parseRaw({ from: pasted.from, subject: pasted.subject, text: pasted.text }));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }
    const result = trace?.result;
    const winner = result?.status === 'parsed' ? result.transaction.amountMinor : null;
    return (_jsxs("div", { className: "vstack", style: { gap: 16 }, children: [error && _jsx(Banner, { kind: "error", onDismiss: () => setError(null), children: error }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Parse a fixture" }), _jsxs("span", { className: "card-note", children: [fixtures?.length ?? 0, " bundled emails"] })] }), _jsxs("div", { className: "hstack", children: [_jsx("select", { className: "control", value: selected, style: { minWidth: 280 }, onChange: (e) => {
                                    setSelected(e.target.value);
                                    void loadFixture(e.target.value);
                                }, children: (fixtures ?? []).map((f) => (_jsxs("option", { value: f.id, children: [f.id, " \u2014 expects ", f.expected.status] }, f.id))) }), _jsx("button", { className: "btn", disabled: !selected || loading, onClick: () => void loadFixture(selected), children: "Re-parse" })] })] }), _jsxs("section", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("h2", { className: "card-title", children: "Or paste an email" }) }), _jsxs("div", { className: "vstack", children: [_jsx("input", { className: "control", placeholder: "From: Bank Alerts <alerts@example.com>", value: pasted.from, onChange: (e) => setPasted({ ...pasted, from: e.target.value }) }), _jsx("input", { className: "control", placeholder: "Subject", value: pasted.subject, onChange: (e) => setPasted({ ...pasted, subject: e.target.value }) }), _jsx("textarea", { className: "control", rows: 5, placeholder: "Paste the email body (plain text or HTML)", value: pasted.text, onChange: (e) => setPasted({ ...pasted, text: e.target.value }) }), _jsx("div", { children: _jsx("button", { className: "btn btn-primary", disabled: loading || pasted.from.trim() === '' || pasted.text.trim() === '', onClick: () => void parsePasted(), children: "Parse it" }) })] })] }), loading && _jsx("div", { className: "card", children: _jsx(LoadingCard, { lines: 5 }) }), !loading && trace && result && (_jsxs(_Fragment, { children: [_jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Result" }), _jsxs("span", { className: "card-note", children: ["parser ", trace.parserVersion, " \u00B7 rules ", trace.rulesPackVersion] })] }), _jsx("div", { className: "stage-chain", style: { marginBottom: 14 }, children: result.debug.stages.map((stage, i) => (_jsx("span", { className: `stage${/:(?!miss)[a-z0-9-]+\)/.test(stage) ? ' stage-hit' : ''}`, children: stage }, i))) }), result.status === 'parsed' ? (_jsxs("dl", { className: "field-grid", children: [_jsx("dt", { children: "Amount" }), _jsxs("dd", { children: [_jsx("b", { children: formatMoney(result.transaction.amountMinor, result.transaction.currencyCode) }), ' ', _jsxs("span", { className: "muted", children: ["(", result.transaction.amountMinor, " minor units)"] })] }), _jsx("dt", { children: "Merchant" }), _jsxs("dd", { children: [result.transaction.merchantDisplay, " ", _jsxs("span", { className: "muted mono", children: ["(", result.transaction.merchantNormalized, ")"] })] }), _jsx("dt", { children: "Raw descriptor" }), _jsx("dd", { className: "mono", children: result.transaction.merchantRaw }), _jsx("dt", { children: "Category" }), _jsxs("dd", { children: [result.transaction.categoryKey, " ", _jsxs("span", { className: "muted", children: ["via ", result.transaction.categorySource] })] }), _jsx("dt", { children: "Date" }), _jsxs("dd", { children: [new Date(result.transaction.occurredAt).toLocaleDateString(), " ", _jsxs("span", { className: "muted", children: ["(", result.debug.dateSource, ")"] })] }), _jsx("dt", { children: "Method" }), _jsx("dd", { className: "mono", children: result.transaction.extractionMethod }), _jsx("dt", { children: "Confidence" }), _jsxs("dd", { children: [(result.transaction.confidence * 100).toFixed(1), "%"] }), _jsx("dt", { children: "Credit?" }), _jsx("dd", { children: result.transaction.isCredit ? 'yes' : 'no' }), _jsx("dt", { children: "Dedupe key" }), _jsx("dd", { className: "mono", children: result.transaction.dedupeKey })] })) : (_jsxs(Banner, { kind: "warn", children: [_jsxs("b", { children: ["Rejected at ", result.stageReached] }), " \u2014 ", result.reason, _jsxs("div", { className: "muted small", style: { marginTop: 4 }, children: ["Telemetry recorded: domain ", result.senderDomain, ", subject shape", ' ', _jsx("span", { className: "mono", children: result.subjectShape })] })] }))] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Scored amount candidates" }), _jsx("span", { className: "card-note", children: "argmax wins" })] }), result.debug.amountCandidates.length === 0 ? (_jsx("p", { className: "muted small", children: "No money-like span was found in this email." })) : (_jsxs("table", { className: "cand-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Score" }), _jsx("th", { children: "Amount" }), _jsx("th", { children: "Span" }), _jsx("th", { children: "Signals" })] }) }), _jsx("tbody", { children: result.debug.amountCandidates.map((c, i) => (_jsxs("tr", { className: winner !== null && c.minorUnits === winner ? 'winner' : '', children: [_jsx("td", { className: c.score >= 0 ? 'score-pos' : 'score-neg', children: _jsx("b", { children: c.score.toFixed(2) }) }), _jsx("td", { className: "mono", children: formatMoney(c.minorUnits, c.currency) }), _jsx("td", { className: "mono", children: c.raw }), _jsx("td", { className: "muted", children: c.reasons.join(', ') })] }, i))) })] }))] }), _jsxs("section", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("h2", { className: "card-title", children: "Text the parser actually saw" }), _jsxs("span", { className: "card-note", children: [result.debug.textLength, " chars after stripping"] })] }), _jsx("div", { className: "code-block", children: result.debug.cleanedText || '(empty)' })] })] }))] }));
}
