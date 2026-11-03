import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Tooltip } from './Tooltip';
import { formatMoney } from '../lib/format';
const WIDTH = 560;
const HEIGHT = 150;
const PAD = { top: 12, right: 8, bottom: 20, left: 46 };
/** Single series, so one hue and no legend — the card title names it. */
export function DailySpendChart({ days, month, currency }) {
    const [tooltip, setTooltip] = useState(null);
    const [hovered, setHovered] = useState(null);
    const [yearStr, monthStr] = month.split('-');
    const daysInMonth = new Date(Number(yearStr), Number(monthStr), 0).getDate();
    const byDay = new Map(days.map((d) => [d.day, d.totalMinor]));
    const series = Array.from({ length: daysInMonth }, (_, i) => {
        const dayNumber = i + 1;
        const key = `${month}-${String(dayNumber).padStart(2, '0')}`;
        return { dayNumber, key, totalMinor: Math.max(0, byDay.get(key) ?? 0) };
    });
    const max = Math.max(...series.map((d) => d.totalMinor), 1);
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const slot = plotW / daysInMonth;
    const barWidth = Math.max(3, slot - 2); // 2px surface gap between adjacent bars
    const radius = Math.min(4, barWidth / 2);
    const ticks = [0, max / 2, max];
    if (days.length === 0) {
        return _jsx("p", { className: "muted small", style: { margin: '12px 0' }, children: "No daily activity recorded for this month." });
    }
    return (_jsxs("div", { className: "chart-wrap", onMouseLeave: () => { setTooltip(null); setHovered(null); }, children: [_jsxs("svg", { className: "chart-svg", viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": "Daily spend for the month", children: [ticks.map((tick, i) => {
                        const y = PAD.top + plotH - (tick / max) * plotH;
                        return (_jsxs("g", { children: [_jsx("line", { className: "grid-line", x1: PAD.left, x2: WIDTH - PAD.right, y1: y, y2: y }), _jsx("text", { className: "axis-text", x: PAD.left - 6, y: y + 3, textAnchor: "end", children: formatMoney(tick, currency, { compact: true }) })] }, i));
                    }), series.map((d) => {
                        const height = d.totalMinor === 0 ? 0 : Math.max(2, (d.totalMinor / max) * plotH);
                        const x = PAD.left + d.dayNumber * slot - slot + (slot - barWidth) / 2;
                        const y = PAD.top + plotH - height;
                        return (_jsxs("g", { children: [_jsx("rect", { x: PAD.left + d.dayNumber * slot - slot, y: PAD.top, width: slot, height: plotH, fill: "transparent", onMouseMove: (event) => {
                                        const rect = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                                        setHovered(d.key);
                                        setTooltip({
                                            x: event.clientX - (rect?.left ?? 0),
                                            y: event.clientY - (rect?.top ?? 0),
                                            content: (_jsxs(_Fragment, { children: [_jsx("div", { className: "tooltip-title", children: new Date(`${d.key}T12:00:00Z`).toLocaleDateString(undefined, {
                                                            weekday: 'short',
                                                            day: 'numeric',
                                                            month: 'short',
                                                        }) }), _jsxs("div", { className: "tooltip-row", children: [_jsx("span", { children: "Spent" }), _jsx("b", { children: formatMoney(d.totalMinor, currency) })] })] })),
                                        });
                                    } }), height > 0 && (_jsx("rect", { className: `bar${hovered !== null && hovered !== d.key ? ' dim' : ''}`, x: x, y: y, width: barWidth, height: height, rx: radius, ry: radius, fill: "var(--series-1)", pointerEvents: "none" }))] }, d.key));
                    }), _jsx("line", { className: "grid-line", x1: PAD.left, x2: WIDTH - PAD.right, y1: PAD.top + plotH, y2: PAD.top + plotH }), [1, Math.round(daysInMonth / 2), daysInMonth].map((dayNumber) => (_jsx("text", { className: "axis-text", x: PAD.left + dayNumber * slot - slot / 2, y: HEIGHT - 6, textAnchor: "middle", children: dayNumber }, dayNumber)))] }), _jsx(Tooltip, { state: tooltip })] }));
}
