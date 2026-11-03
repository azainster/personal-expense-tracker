/**
 * Category → colour slot.
 *
 * The validated categorical palette has eight slots and they are never cycled, so the
 * taxonomy's twelve categories cannot each own a hue. Slots are assigned to a **fixed**
 * category, not to rank — filtering to a different month must never repaint a category —
 * and everything without a slot folds into one neutral "Other" wedge. Health and Other are
 * the folded pair: both are episodic or catch-all, and both still appear with exact
 * amounts in the category table, which is also the relief for the three light-mode hues
 * that sit below 3:1 against the surface.
 *
 * Transfers and Income never reach a chart — they are excluded from spend totals by design.
 */
const SLOT_BY_CATEGORY: Record<string, number> = {
  food_dining: 1,
  shopping: 2,
  groceries: 3,
  transport: 4,
  cafe: 5,
  bills: 6,
  travel: 7,
  entertainment: 8,
};

export const OTHER_KEY = '__other__';

export function colorVarFor(categoryKey: string | null | undefined): string {
  const slot = categoryKey ? SLOT_BY_CATEGORY[categoryKey] : undefined;
  return slot ? `var(--series-${slot})` : 'var(--series-other)';
}

export function hasOwnSlot(categoryKey: string | null | undefined): boolean {
  return Boolean(categoryKey && SLOT_BY_CATEGORY[categoryKey]);
}

export interface WedgeDatum {
  key: string;
  name: string;
  totalMinor: number;
  share: number;
  count: number;
  color: string;
  /** Categories folded into this wedge, for the tooltip. */
  folded?: Array<{ name: string; totalMinor: number }>;
}

/** Builds donut wedges: slotted categories keep their hue, the rest become one Other wedge. */
export function buildWedges(
  stats: Array<{ categoryKey: string; name: string; totalMinor: number; share: number; count: number }>,
): WedgeDatum[] {
  const wedges: WedgeDatum[] = [];
  const folded: Array<{ name: string; totalMinor: number }> = [];
  let foldedTotal = 0;
  let foldedShare = 0;
  let foldedCount = 0;

  for (const stat of stats) {
    if (stat.totalMinor <= 0) continue;
    if (hasOwnSlot(stat.categoryKey)) {
      wedges.push({
        key: stat.categoryKey,
        name: stat.name,
        totalMinor: stat.totalMinor,
        share: stat.share,
        count: stat.count,
        color: colorVarFor(stat.categoryKey),
      });
    } else {
      folded.push({ name: stat.name, totalMinor: stat.totalMinor });
      foldedTotal += stat.totalMinor;
      foldedShare += stat.share;
      foldedCount += stat.count;
    }
  }

  wedges.sort((a, b) => b.totalMinor - a.totalMinor);
  if (foldedTotal > 0) {
    wedges.push({
      key: OTHER_KEY,
      name: folded.length === 1 ? (folded[0]?.name ?? 'Other') : 'Other',
      totalMinor: foldedTotal,
      share: foldedShare,
      count: foldedCount,
      color: 'var(--series-other)',
      folded: folded.length > 1 ? folded : undefined,
    });
  }
  return wedges;
}
