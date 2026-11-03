import { useState } from 'react';
import { Tooltip, type TooltipState } from './Tooltip';
import { formatMoney } from '../lib/format';

const WIDTH = 560;
const HEIGHT = 150;
const PAD = { top: 12, right: 8, bottom: 20, left: 46 };

interface Props {
  days: Array<{ day: string; totalMinor: number }>;
  month: string;
  currency: string;
}

/** Single series, so one hue and no legend — the card title names it. */
export function DailySpendChart({ days, month, currency }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

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
    return <p className="muted small" style={{ margin: '12px 0' }}>No daily activity recorded for this month.</p>;
  }

  return (
    <div className="chart-wrap" onMouseLeave={() => { setTooltip(null); setHovered(null); }}>
      <svg className="chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Daily spend for the month">
        {ticks.map((tick, i) => {
          const y = PAD.top + plotH - (tick / max) * plotH;
          return (
            <g key={i}>
              <line className="grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} />
              <text className="axis-text" x={PAD.left - 6} y={y + 3} textAnchor="end">
                {formatMoney(tick, currency, { compact: true })}
              </text>
            </g>
          );
        })}

        {series.map((d) => {
          const height = d.totalMinor === 0 ? 0 : Math.max(2, (d.totalMinor / max) * plotH);
          const x = PAD.left + d.dayNumber * slot - slot + (slot - barWidth) / 2;
          const y = PAD.top + plotH - height;
          return (
            <g key={d.key}>
              {/* Invisible hit target, larger than the mark. */}
              <rect
                x={PAD.left + d.dayNumber * slot - slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseMove={(event) => {
                  const rect = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                  setHovered(d.key);
                  setTooltip({
                    x: event.clientX - (rect?.left ?? 0),
                    y: event.clientY - (rect?.top ?? 0),
                    content: (
                      <>
                        <div className="tooltip-title">
                          {new Date(`${d.key}T12:00:00Z`).toLocaleDateString(undefined, {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })}
                        </div>
                        <div className="tooltip-row">
                          <span>Spent</span>
                          <b>{formatMoney(d.totalMinor, currency)}</b>
                        </div>
                      </>
                    ),
                  });
                }}
              />
              {height > 0 && (
                <rect
                  className={`bar${hovered !== null && hovered !== d.key ? ' dim' : ''}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={radius}
                  ry={radius}
                  fill="var(--series-1)"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        <line className="grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
        {[1, Math.round(daysInMonth / 2), daysInMonth].map((dayNumber) => (
          <text
            key={dayNumber}
            className="axis-text"
            x={PAD.left + dayNumber * slot - slot / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
          >
            {dayNumber}
          </text>
        ))}
      </svg>
      <Tooltip state={tooltip} />
    </div>
  );
}
