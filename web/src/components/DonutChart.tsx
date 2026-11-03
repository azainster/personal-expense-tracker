import { useState } from 'react';
import { Tooltip, type TooltipState } from './Tooltip';
import { formatMoney, formatPercent } from '../lib/format';
import type { WedgeDatum } from '../lib/palette';

const SIZE = 220;
const RADIUS = 96;
const THICKNESS = 26;
/** 2px surface gap between adjacent fills, expressed as a gap angle at this radius. */
const GAP_PX = 2;

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(startAngle: number, endAngle: number): string {
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

interface Props {
  wedges: WedgeDatum[];
  totalMinor: number;
  currency: string;
  activeKey?: string | null;
  onSelect?: (key: string | null) => void;
}

export function DonutChart({ wedges, totalMinor, currency, activeKey, onSelect }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const total = wedges.reduce((sum, w) => sum + w.totalMinor, 0);
  if (total <= 0) {
    return (
      <div className="state" style={{ padding: '32px 0' }}>
        <p className="muted small">No spend to chart in this month.</p>
      </div>
    );
  }

  const gapAngle = (GAP_PX / (2 * Math.PI * RADIUS)) * 360;
  let cursor = 0;

  return (
    <div className="chart-wrap" onMouseLeave={() => { setTooltip(null); setHovered(null); }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ maxWidth: SIZE }}
        role="img"
        aria-label={`Spending by category, total ${formatMoney(totalMinor, currency)}`}
      >
        {wedges.map((wedge) => {
          const sweep = (wedge.totalMinor / total) * 360;
          const start = cursor;
          const end = cursor + sweep;
          cursor = end;
          const drawStart = sweep > gapAngle * 2 ? start + gapAngle / 2 : start;
          const drawEnd = sweep > gapAngle * 2 ? end - gapAngle / 2 : end;
          const isDim = (hovered !== null && hovered !== wedge.key) || (activeKey != null && activeKey !== wedge.key);

          return (
            <path
              key={wedge.key}
              className={`wedge${isDim ? ' dim' : ''}`}
              d={arcPath(drawStart, drawEnd)}
              fill={wedge.color}
              onMouseMove={(event) => {
                const rect = event.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect();
                setHovered(wedge.key);
                setTooltip({
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                  content: (
                    <>
                      <div className="tooltip-title">
                        <span className="swatch" style={{ background: wedge.color }} />
                        {wedge.name}
                      </div>
                      <div className="tooltip-row">
                        <span>Spent</span>
                        <b>{formatMoney(wedge.totalMinor, currency)}</b>
                      </div>
                      <div className="tooltip-row">
                        <span>Share</span>
                        <b>{formatPercent(wedge.share)}</b>
                      </div>
                      <div className="tooltip-row">
                        <span>Transactions</span>
                        <b>{wedge.count}</b>
                      </div>
                      {wedge.folded?.map((f) => (
                        <div className="tooltip-row" key={f.name}>
                          <span className="muted">· {f.name}</span>
                          <b>{formatMoney(f.totalMinor, currency)}</b>
                        </div>
                      ))}
                    </>
                  ),
                });
              }}
              onClick={() => onSelect?.(activeKey === wedge.key ? null : wedge.key)}
            />
          );
        })}

        <text className="donut-center-value" x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle">
          {formatMoney(totalMinor, currency, { compact: true })}
        </text>
        <text className="donut-center-label" x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle">
          Total spend
        </text>
      </svg>
      <Tooltip state={tooltip} />
    </div>
  );
}
