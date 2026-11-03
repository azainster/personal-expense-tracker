/** Expense-specific components: category icons, transaction rows, charts, month switcher. */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CategoryRow, TransactionRow as Tx } from '@expense/core';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { monthLabel } from '@/lib/configHelpers';
import { money, shortDate } from '@/lib/format';
import { sourceDisplay, UNKNOWN_SOURCE_KEY, type SourceTotal } from '@/lib/sources';
import { radius, spacing, type, useTheme } from '@/theme';
import type { IconName } from './ui';

const CATEGORY_ICONS: Record<string, IconName> = {
  cart: 'cart-outline',
  fork: 'restaurant-outline',
  cup: 'cafe-outline',
  car: 'car-outline',
  bag: 'bag-handle-outline',
  bolt: 'flash-outline',
  play: 'film-outline',
  heart: 'heart-outline',
  plane: 'airplane-outline',
  arrows: 'swap-horizontal-outline',
  'arrow-down': 'arrow-down-circle-outline',
  repeat: 'repeat-outline',
  cube: 'cube-outline',
  tag: 'pricetag-outline',
};

/** Icons for financial sources — a bank account, a card, or the catch-all. */
const SOURCE_ICONS: Record<string, IconName> = {
  bank: 'business-outline',
  card: 'card-outline',
  wallet: 'wallet-outline',
};

export function CategoryIcon({ icon, color, size = 36 }: { icon: string | undefined; color: string | undefined; size?: number }) {
  const tint = color ?? '#7A7A7A';
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${tint}22`, alignItems: 'center', justifyContent: 'center' }}
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={CATEGORY_ICONS[icon ?? 'tag'] ?? 'pricetag-outline'} size={size * 0.5} color={tint} />
    </View>
  );
}

export function SourceIcon({ icon, color, size = 36 }: { icon: string | undefined; color: string | undefined; size?: number }) {
  const tint = color ?? '#7A7A7A';
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: `${tint}22`, alignItems: 'center', justifyContent: 'center' }}
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name={SOURCE_ICONS[icon ?? 'wallet'] ?? 'wallet-outline'} size={size * 0.5} color={tint} />
    </View>
  );
}

/**
 * One financial account on the dashboard: what it spent this month, and a tap through to that
 * account's transactions.
 */
export function AccountRow({ source, currency, onPress, first }: { source: SourceTotal; currency: string; onPress: () => void; first?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${source.label}, ${money(source.totalMinor, currency)}, ${source.count} ${source.count === 1 ? 'transaction' : 'transactions'}. Shows these transactions.`}
      style={({ pressed }) => [
        styles.accountRow,
        { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
      ]}
    >
      <SourceIcon icon={source.icon} color={source.colorHex} size={38} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[type.body, { color: colors.text, fontWeight: '500' }]} numberOfLines={1}>
          {source.label}
        </Text>
        <View style={[styles.shareTrack, { backgroundColor: colors.chartTrack }]}>
          <View style={{ width: `${Math.max(2, source.share * 100)}%`, height: 4, borderRadius: 2, backgroundColor: source.colorHex }} />
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[type.body, { color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{money(source.totalMinor, currency)}</Text>
        <Text style={[type.caption, { color: colors.textSecondary }]}>
          {source.count} {source.count === 1 ? 'txn' : 'txns'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

export const TransactionListRow = memo(function TransactionListRow({
  tx,
  category,
  onPress,
  showDate = false,
}: {
  tx: Tx;
  category: CategoryRow | undefined;
  onPress: () => void;
  showDate?: boolean;
}) {
  const { colors } = useTheme();
  const source = sourceDisplay(tx.sourceKey);
  const subtitle = [
    category?.name ?? 'Uncategorized',
    source.key === UNKNOWN_SOURCE_KEY ? null : source.shortLabel,
    showDate ? shortDate(tx.occurredAt) : null,
    tx.accountLast4 ? `•••• ${tx.accountLast4}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const amount = money(tx.isCredit ? -tx.amountMinor : tx.amountMinor, tx.currencyCode);
  const label = `${tx.merchantDisplay}, ${tx.isCredit ? 'credit' : 'spent'} ${money(tx.amountMinor, tx.currencyCode)}, ${subtitle}${tx.needsReview ? ', needs review' : ''}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceMuted : colors.surface }]}
    >
      <CategoryIcon icon={category?.icon} color={category?.colorHex} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[type.body, { color: colors.text, fontWeight: '500', flexShrink: 1 }]} numberOfLines={1}>
            {tx.merchantDisplay}
          </Text>
          {tx.needsReview ? <Ionicons name="alert-circle" size={15} color={colors.warning} /> : null}
          {(tx.duplicateCount ?? 0) > 0 ? <Ionicons name="layers-outline" size={14} color={colors.textTertiary} /> : null}
        </View>
        <Text style={[type.footnote, { color: colors.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text
          style={[
            type.body,
            { fontWeight: '600', fontVariant: ['tabular-nums'], color: tx.isCredit ? colors.positive : tx.isExcludedFromTotals ? colors.textTertiary : colors.text },
          ]}
        >
          {tx.isCredit ? `+${money(tx.amountMinor, tx.currencyCode)}` : amount}
        </Text>
        {tx.isExcludedFromTotals ? <Text style={[type.caption, { color: colors.textTertiary }]}>Not counted</Text> : null}
      </View>
    </Pressable>
  );
});

export interface DonutSegment {
  key: string;
  value: number;
  color: string;
}

export function DonutChart({ segments, size = 180, thickness = 22, children }: { segments: DonutSegment[]; size?: number; thickness?: number; children?: React.ReactNode }) {
  const { colors } = useTheme();
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const visible = segments.filter((s) => s.value > 0);
  const gap = visible.length > 1 ? Math.min(3, circumference * 0.006) : 0;
  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.chartTrack} strokeWidth={thickness} fill="none" />
          {total > 0
            ? visible.map((segment) => {
                const length = (segment.value / total) * circumference;
                const dash = Math.max(0.5, length - gap);
                const circle = (
                  <Circle
                    key={segment.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={segment.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-offset}
                    fill="none"
                  />
                );
                offset += length;
                return circle;
              })
            : null}
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.donutCenter}>{children}</View>
      </View>
    </View>
  );
}

export function DailyBars({ month, byDay, currency }: { month: string; byDay: { day: string; totalMinor: number }[]; currency: string }) {
  const { colors } = useTheme();
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y ?? 2000, m ?? 1, 0).getDate();
  const totals = new Map(byDay.map((d) => [Number(d.day.slice(8, 10)), Math.max(0, d.totalMinor)]));
  const max = Math.max(1, ...totals.values());
  const busiest = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <View
      accessible
      accessibilityLabel={busiest ? `Daily spending. Highest on day ${busiest[0]}: ${money(busiest[1], currency)}` : 'Daily spending'}
    >
      <View style={styles.bars}>
        {Array.from({ length: daysInMonth }, (_, i) => {
          const value = totals.get(i + 1) ?? 0;
          const height = value > 0 ? Math.max(3, (value / max) * 72) : 2;
          return (
            <View key={i} style={styles.barSlot}>
              <View style={{ height, borderRadius: 2, backgroundColor: value > 0 ? colors.accent : colors.chartTrack }} />
            </View>
          );
        })}
      </View>
      <View style={styles.barLabels}>
        <Text style={[type.caption, { color: colors.textTertiary }]}>1</Text>
        <Text style={[type.caption, { color: colors.textTertiary }]}>15</Text>
        <Text style={[type.caption, { color: colors.textTertiary }]}>{daysInMonth}</Text>
      </View>
    </View>
  );
}

export function MonthSwitcher({
  month,
  currentMonth,
  onPrevious,
  onNext,
  canGoNext,
}: {
  month: string;
  currentMonth: string;
  onPrevious: () => void;
  onNext: () => void;
  canGoNext: boolean;
}) {
  const { colors } = useTheme();
  const label = monthLabel(month, currentMonth);
  return (
    <View style={[styles.switcher, { backgroundColor: colors.surface }]}>
      <Pressable onPress={onPrevious} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={12} style={styles.switcherButton}>
        <Ionicons name="chevron-back" size={22} color={colors.accent} />
      </Pressable>
      <Text style={[type.headline, { color: colors.text }]} accessibilityRole="header" accessibilityLabel={`Showing ${label}`}>
        {label}
      </Text>
      <Pressable
        onPress={onNext}
        disabled={!canGoNext}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !canGoNext }}
        hitSlop={12}
        style={[styles.switcherButton, { opacity: canGoNext ? 1 : 0.3 }]}
      >
        <Ionicons name="chevron-forward" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 64 },
  shareTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  donutCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 76, gap: 2 },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  switcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  switcherButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
