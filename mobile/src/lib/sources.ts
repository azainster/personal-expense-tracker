/**
 * Financial accounts and cards, for the UI.
 *
 * Labels, colours and icons come from the active rules pack, so adding a card is a pack edit
 * rather than a code change — and none of this touches which Gmail account is connected.
 */
import { financialSourceInfo, listFinancialSources, UNKNOWN_SOURCE_KEY, type SourceStat } from '@expense/core';
import { activeRulesPack } from './rulesPack';

export { UNKNOWN_SOURCE_KEY };

export interface SourceDisplay {
  key: string;
  label: string;
  shortLabel: string;
  colorHex: string;
  icon: string;
  kind: string;
}

/** Details for a stored `sourceKey`; unknown keys become the "Other" bucket, never a blank. */
export function sourceDisplay(sourceKey: string | null | undefined): SourceDisplay {
  return financialSourceInfo(activeRulesPack(), sourceKey);
}

/** The accounts the app tracks, in pack order (cards before the bank they belong to). */
export function trackedSources(): SourceDisplay[] {
  return listFinancialSources(activeRulesPack()).map((source) => ({
    key: source.key,
    label: source.label,
    shortLabel: source.shortLabel,
    colorHex: source.colorHex,
    icon: source.icon,
    kind: source.kind,
  }));
}

export type SourceTotal = SourceDisplay & SourceStat;

/** Per-account totals with their labels attached, biggest spend first, "Other" always last. */
export function describeSourceTotals(stats: SourceStat[]): SourceTotal[] {
  return stats
    .map((stat) => ({ ...sourceDisplay(stat.sourceKey), ...stat }))
    .sort((a, b) => {
      const aOther = a.key === UNKNOWN_SOURCE_KEY ? 1 : 0;
      const bOther = b.key === UNKNOWN_SOURCE_KEY ? 1 : 0;
      if (aOther !== bOther) return aOther - bOther;
      return b.totalMinor - a.totalMinor;
    });
}

const KIND_LABELS: Record<string, string> = {
  debit: 'Debit',
  purchase: 'Purchase',
  credit: 'Money in',
  refund: 'Refund',
  transfer: 'Transfer',
};

export function txnKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}
