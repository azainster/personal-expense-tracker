import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatMoney, formatPercent } from '../lib/format';
import { colorVarFor } from '../lib/palette';
/**
 * The table view. It is also the relief required by the palette's contrast warning:
 * every category carries a visible name and an exact number, never colour alone.
 */
export function CategoryTable({ stats, currency, activeKey, onSelect }) {
    if (stats.length === 0) {
        return _jsx("p", { className: "muted small", children: "Nothing categorised yet this month." });
    }
    return (_jsxs("table", { className: "cat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Category" }), _jsx("th", { className: "num", children: "Spent" }), _jsx("th", { className: "num", children: "Share" }), _jsx("th", { className: "num", children: "Txns" })] }) }), _jsx("tbody", { children: stats.map((stat) => (_jsxs("tr", { className: activeKey === stat.categoryKey ? 'active' : '', onClick: () => onSelect(activeKey === stat.categoryKey ? null : stat.categoryKey), tabIndex: 0, onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelect(activeKey === stat.categoryKey ? null : stat.categoryKey);
                        }
                    }, children: [_jsx("td", { children: _jsxs("span", { className: "cat-name", children: [_jsx("span", { className: "swatch", style: { background: colorVarFor(stat.categoryKey) } }), stat.name] }) }), _jsx("td", { className: "num", children: formatMoney(stat.totalMinor, currency) }), _jsx("td", { className: "num muted", children: formatPercent(stat.share) }), _jsx("td", { className: "num muted", children: stat.count })] }, stat.categoryKey))) })] }));
}
