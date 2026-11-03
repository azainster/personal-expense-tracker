import { formatMoney, formatPercent } from '../lib/format';
import { colorVarFor } from '../lib/palette';
import type { CategoryStat } from '../types';

interface Props {
  stats: CategoryStat[];
  currency: string;
  activeKey: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * The table view. It is also the relief required by the palette's contrast warning:
 * every category carries a visible name and an exact number, never colour alone.
 */
export function CategoryTable({ stats, currency, activeKey, onSelect }: Props) {
  if (stats.length === 0) {
    return <p className="muted small">Nothing categorised yet this month.</p>;
  }
  return (
    <table className="cat-table">
      <thead>
        <tr>
          <th>Category</th>
          <th className="num">Spent</th>
          <th className="num">Share</th>
          <th className="num">Txns</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((stat) => (
          <tr
            key={stat.categoryKey}
            className={activeKey === stat.categoryKey ? 'active' : ''}
            onClick={() => onSelect(activeKey === stat.categoryKey ? null : stat.categoryKey)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(activeKey === stat.categoryKey ? null : stat.categoryKey);
              }
            }}
          >
            <td>
              <span className="cat-name">
                <span className="swatch" style={{ background: colorVarFor(stat.categoryKey) }} />
                {stat.name}
              </span>
            </td>
            <td className="num">{formatMoney(stat.totalMinor, currency)}</td>
            <td className="num muted">{formatPercent(stat.share)}</td>
            <td className="num muted">{stat.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
