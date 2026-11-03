import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Tooltip } from './Tooltip';
import { formatMoney, formatPercent } from '../lib/format';
const SIZE = 220;
const RADIUS = 96;
const THICKNESS = 26;
/** 2px surface gap between adjacent fills, expressed as a gap angle at this radius. */
const GAP_PX = 2;
function polar(cx, cy, r, angle) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}
function arcPath(startAngle, endAngle) {
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const outer = RADIUS;
    const inner = RADIUS - THICKNESS;
    const large = endAngle - startAngle > 180 ? 1 : 0;
    const [x1, y1] = polar(cx, cy, outer, startAngle);
    const [x2, y2] = polar(cx, cy, outer, endAngle);
    const [x3, y3] = polar(cx, cy, inner, endAngle);
    const [x4, y4] = polar(cx, cy, inner, startAngle);
    return [
        `M ${x1} ${y1}`,
        `A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
        'Z',
    ].join(' ');
}
export function DonutChart({ wedges, totalMinor, currency, activeKey, onSelect }) {
    const [tooltip, setTooltip] = useState(null);
    const [hovered, setHovered] = useState(null);
    const total = wedges.reduce((sum, w) => sum + w.totalMinor, 0);
    if (total <= 0) {
        return (_jsx("div", { className: "state", style: { padding: '32px 0' }, children: _jsx("p", { className: "muted small", children: "No spend to chart in this month." }) }));
    }
    const gapAngle = (GAP_PX / (2 * Math.PI * RADIUS)) * 360;
    let cursor = 0;
    return (_jsxs("div", { className: "chart-wrap", onMouseLeave: () => { setTooltip(null); setHovered(null); }, children: [_jsxs("svg", { className: "chart-svg", viewBox: `0 0 ${SIZE} ${SIZE}`, style: { maxWidth: SIZE }, role: "img", "aria-label": `Spending by category, total ${formatMoney(totalMinor, currency)}`, children: [wedges.map((wedge) => {
                        const sweep = (wedge.totalMinor / total) * 360;
                        const start = cursor;
                        const end = cursor + sweep;
                        cursor = end;
                        const drawStart = sweep > gapAngle * 2 ? start + gapAngle / 2 : start;
                        const drawEnd = sweep > gapAngle * 2 ? end - gapAngle / 2 : end;
                        const isDim = (hovered !== null && hovered !== wedge.key) || (activeKey != null && activeKey !== wedge.key);
                        return (_jsx("path", { className: `wedge${isDim ? ' dim' : ''}`, d: arcPath(drawStart, drawEnd), fill: wedge.color, onMouseMove: (event) => {
                                const rect = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                                setHovered(wedge.key);
                                setTooltip({
                                    x: event.clientX - (rect?.left ?? 0),
                                    y: event.clientY - (rect?.top ?? 0),
                                    content: (_jsxs(_Fragment, { children: [_jsxs("div", { className: "tooltip-title", children: [_jsx("span", { className: "swatch", style: { background: wedge.color } }), wedge.name] }), _jsxs("div", { className: "tooltip-row", children: [_jsx("span", { children: "Spent" }), _jsx("b", { children: formatMoney(wedge.totalMinor, currency) })] }), _jsxs("div", { className: "tooltip-row", children: [_jsx("span", { children: "Share" }), _jsx("b", { children: formatPercent(wedge.share) })] }), _jsxs("div", { className: "tooltip-row", children: [_jsx("span", { children: "Transactions" }), _jsx("b", { children: wedge.count })] }), wedge.folded?.map((f) => (_jsxs("div", { className: "tooltip-row", children: [_jsxs("span", { className: "muted", children: ["\u00B7 ", f.name] }), _jsx("b", { children: formatMoney(f.totalMinor, currency) })] }, f.name)))] })),
                                });
                            }, onClick: () => onSelect?.(activeKey === wedge.key ? null : wedge.key) }, wedge.key));
                    }), _jsx("text", { className: "donut-center-value", x: SIZE / 2, y: SIZE / 2 - 2, textAnchor: "middle", children: formatMoney(totalMinor, currency, { compact: true }) }), _jsx("text", { className: "donut-center-label", x: SIZE / 2, y: SIZE / 2 + 16, textAnchor: "middle", children: "Total spend" })] }), _jsx(Tooltip, { state: tooltip })] }));
}
