import { formatDate, formatMoney } from '../lib/format';
import { colorVarFor } from '../lib/palette';
import type { Category, Transaction } from '../types';

interface Props {
  transactions: Transaction[];
  categories: Category[];
  currency: string | null;
  onSelect: (transaction: Transaction) => void;
}

export function TransactionList({ transactions, categories, onSelect }: Props) {
  const nameOf = (key: string | null): string =>
    categories.find((c) => c.key === key)?.name ?? 'Uncategorised';

  return (
    <div className="txn-list">
      {transactions.map((tx) => (
        <button key={tx.id} className="txn-row" onClick={() => onSelect(tx)}>
          <span className="txn-date">{formatDate(tx.occurredAt)}</span>
          <span>
            <span className="txn-merchant">
              {tx.merchantDisplay}
              {tx.needsReview && <span className="badge badge-review">check</span>}
              {(tx.duplicateCount ?? 0) > 0 && (
                <span className="badge badge-dupe" title="Duplicate emails merged into this transaction">
                  +{tx.duplicateCount} merged
                </span>
              )}
              {tx.isExcludedFromTotals && <span className="badge badge-excluded">not in total</span>}
            </span>
            <span className="txn-meta">
              <span className="cat-name">
                <span className="swatch" style={{ background: colorVarFor(tx.categoryKey) }} />
                {nameOf(tx.categoryKey)}
              </span>
              <span>·</span>
              <span>{tx.extractionMethod}</span>
              {tx.accountLast4 && (
                <>
                  <span>·</span>
                  <span>•••• {tx.accountLast4}</span>
                </>
              )}
              {tx.source === 'sample' && (
                <>
                  <span>·</span>
                  <span>sample</span>
                </>
              )}
            </span>
          </span>
          <span className={`txn-amount${tx.isCredit ? ' credit' : ''}`}>
            {tx.isCredit ? '+' : ''}
            {formatMoney(tx.amountMinor, tx.currencyCode)}
          </span>
        </button>
      ))}
    </div>
  );
}
