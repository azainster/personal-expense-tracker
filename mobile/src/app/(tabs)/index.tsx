/** Overview (§7 Step 6): month total with switcher, donut by category, category list, drill-down. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AccountRow, CategoryIcon, DailyBars, DonutChart, MonthSwitcher } from '@/components/finance';
import { SyncStatus } from '@/components/SyncStatus';
import { EmptyState, ErrorView, InlineLoading } from '@/components/states';
import { Button, Card, LargeTitle, Pill, Screen, SectionLabel } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { appConfig } from '@/lib/config';
import { monthLabel, shiftMonthKey } from '@/lib/configHelpers';
import { money, moneyRounded, percent } from '@/lib/format';
import { describeSourceTotals, sourceDisplay, trackedSources } from '@/lib/sources';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';

export default function Overview() {
  const { colors } = useTheme();
  const { state, actions } = useApp();
  const currentMonth = state.services?.store.currentMonth() ?? new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [currency, setCurrency] = useState<string | null>(null);
  /** null = every account together. */
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  const { data, error, loading, reload } = useStoreQuery(
    ({ store }) =>
      store.summary({
        month,
        defaultCurrency: appConfig.defaultCurrency,
        ...(currency ? { currency } : {}),
        ...(sourceKey ? { sourceKey } : {}),
      }),
    [month, currency, sourceKey],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (state.account) await actions.syncNow('auto');
      else reload();
    } finally {
      setRefreshing(false);
    }
  }, [actions, reload, state.account]);

  const segments = useMemo(
    () => (data?.byCategory ?? []).filter((c) => c.totalMinor > 0).map((c) => ({ key: c.categoryKey, value: c.totalMinor, color: c.colorHex })),
    [data],
  );

  // Per-account spending always covers every account, even when the figures below are filtered.
  const accounts = useMemo(() => describeSourceTotals(data?.bySource ?? []), [data]);
  const selectedAccount = sourceKey ? sourceDisplay(sourceKey) : null;
  const accountFilters = useMemo(() => {
    const options = new Map<string, { key: string; shortLabel: string }>();
    for (const account of accounts) if (account.count > 0) options.set(account.key, account);
    for (const tracked of trackedSources()) if (!options.has(tracked.key)) options.set(tracked.key, tracked);
    return [...options.values()];
  }, [accounts]);

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />;
  const hasAnyData = (data?.availableMonths.length ?? 0) > 0;

  const header = (
    <>
      <LargeTitle title="Overview" subtitle={state.account ? state.account.email : null} />
      <SyncStatus />
    </>
  );

  if (error) {
    return (
      <Screen refreshControl={refresh}>
        {header}
        <ErrorView message={error} onRetry={reload} />
      </Screen>
    );
  }

  if (loading || !data) {
    return (
      <Screen>
        {header}
        <InlineLoading label="Loading your spending…" />
      </Screen>
    );
  }

  if (!hasAnyData) {
    return (
      <Screen refreshControl={refresh}>
        {header}
        {state.account ? (
          state.sync.running || !state.sync.lastRun ? (
            <EmptyState icon="search-outline" title="Looking for receipts" message="Reading transaction emails from the last 35 days. The first sync can take a minute." />
          ) : (
            <EmptyState
              icon="mail-unread-outline"
              title="No expenses found yet"
              message="No receipts or bank alerts turned up in the last 35 days. New ones appear here automatically."
            >
              <Button title="Sync again" icon="refresh" variant="secondary" onPress={() => actions.syncNow('discovery')} disabled={!state.online} />
              <Button title="See what was skipped" variant="plain" onPress={() => router.push('/activity')} />
            </EmptyState>
          )
        ) : (
          <EmptyState icon="receipt-outline" title="No expenses yet" message="Connect Gmail to import receipts and bank alerts, or look around with demo data first.">
            <Button title="Connect Gmail" icon="logo-google" onPress={() => router.push('/connect')} />
            <Button
              title="Load demo data"
              variant="secondary"
              loading={loadingDemo}
              onPress={async () => {
                setLoadingDemo(true);
                try {
                  await actions.loadDemo();
                } finally {
                  setLoadingDemo(false);
                }
              }}
            />
          </EmptyState>
        )}
      </Screen>
    );
  }

  const change = data.changeVsPreviousMinor;
  const previousLabel = monthLabel(data.previousMonth.month, currentMonth);

  return (
    <Screen refreshControl={refresh}>
      {header}

      <MonthSwitcher
        month={month}
        currentMonth={currentMonth}
        onPrevious={() => setMonth((m) => shiftMonthKey(m, -1))}
        onNext={() => setMonth((m) => shiftMonthKey(m, 1))}
        canGoNext={month < currentMonth}
      />

      {accountFilters.length > 1 ? (
        <View style={styles.currencies} accessibilityRole="tablist">
          <Pill label="All accounts" tone={sourceKey === null ? 'accent' : 'neutral'} onPress={() => setSourceKey(null)} />
          {accountFilters.map((account) => (
            <Pill
              key={account.key}
              label={account.shortLabel}
              tone={sourceKey === account.key ? 'accent' : 'neutral'}
              onPress={() => setSourceKey(account.key)}
            />
          ))}
        </View>
      ) : null}

      {data.availableCurrencies.length > 1 ? (
        <View style={styles.currencies} accessibilityRole="tablist">
          {data.availableCurrencies.map((code) => (
            <Pill key={code} label={code} tone={code === data.currency ? 'accent' : 'neutral'} onPress={() => setCurrency(code)} />
          ))}
        </View>
      ) : null}

      <Card style={{ gap: spacing.xs }}>
        <Text style={[type.subhead, { color: colors.textSecondary }]}>
          {selectedAccount ? selectedAccount.label : 'Total expenditure'} · {monthLabel(month, currentMonth)}
        </Text>
        <Text style={[type.hero, { color: colors.text, fontVariant: ['tabular-nums'] }]} accessibilityLabel={`Total spent ${money(data.totalSpentMinor, data.currency)}`}>
          {moneyRounded(data.totalSpentMinor, data.currency)}
        </Text>
        {data.previousMonth.transactionCount > 0 && change !== 0 ? (
          <View style={styles.changeRow}>
            <Ionicons name={change > 0 ? 'arrow-up' : 'arrow-down'} size={14} color={change > 0 ? colors.danger : colors.positive} />
            <Text style={[type.subhead, { color: change > 0 ? colors.danger : colors.positive }]}>
              {moneyRounded(Math.abs(change), data.currency)} {change > 0 ? 'more' : 'less'} than {previousLabel}
            </Text>
          </View>
        ) : null}
        <Text style={[type.footnote, { color: colors.textSecondary }]}>
          {data.transactionCount} {data.transactionCount === 1 ? 'transaction' : 'transactions'}
          {data.excludedCount > 0 ? ` · ${data.excludedCount} transfers & income not counted` : ''}
        </Text>
        {data.totalIncomeMinor > 0 ? (
          <Text style={[type.footnote, { color: colors.positive }]}>Income received {moneyRounded(data.totalIncomeMinor, data.currency)}</Text>
        ) : null}
      </Card>

      {accounts.length > 1 ? (
        <>
          <SectionLabel>By account</SectionLabel>
          <Card padded={false}>
            {accounts.map((account, index) => (
              <AccountRow
                key={account.key}
                source={account}
                currency={data.currency}
                first={index === 0}
                onPress={() => router.push({ pathname: '/transactions', params: { source: account.key } })}
              />
            ))}
          </Card>
        </>
      ) : null}

      {data.needsReviewCount > 0 ? (
        <Pressable
          onPress={() => router.push({ pathname: '/transactions', params: { filter: 'review' } })}
          accessibilityRole="button"
          accessibilityLabel={`${data.needsReviewCount} transactions need a quick check`}
        >
          <Card style={styles.reviewCard}>
            <Ionicons name="alert-circle" size={22} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: colors.text, fontSize: 15 }]}>
                {data.needsReviewCount} {data.needsReviewCount === 1 ? 'expense needs' : 'expenses need'} a quick check
              </Text>
              <Text style={[type.footnote, { color: colors.textSecondary }]}>We weren’t fully sure about the amount or merchant.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </Card>
        </Pressable>
      ) : null}

      {data.transactionCount === 0 ? (
        <Card>
          <EmptyState icon="calendar-outline" title={`Nothing spent in ${monthLabel(month, currentMonth)}`} message="No counted expenses this month.">
            {data.availableMonths[0] && data.availableMonths[0] !== month ? (
              <Button title={`Go to ${monthLabel(data.availableMonths[0], currentMonth)}`} variant="secondary" onPress={() => setMonth(data.availableMonths[0] as string)} />
            ) : null}
          </EmptyState>
        </Card>
      ) : (
        <>
          <SectionLabel>By category</SectionLabel>
          <Card padded={false}>
            <View style={styles.donutWrap}>
              <DonutChart segments={segments}>
                <Text style={[type.caption, { color: colors.textSecondary }]}>{data.byCategory.length} categories</Text>
                <Text style={[type.headline, { color: colors.text, fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit>
                  {moneyRounded(data.totalSpentMinor, data.currency)}
                </Text>
              </DonutChart>
            </View>
            {data.byCategory.map((category) => (
              <Pressable
                key={category.categoryKey}
                onPress={() => router.push({ pathname: '/category/[key]', params: { key: category.categoryKey, month, currency: data.currency } })}
                accessibilityRole="button"
                accessibilityLabel={`${category.name}, ${money(category.totalMinor, data.currency)}, ${percent(category.share)} of spending, ${category.count} transactions`}
                style={({ pressed }) => [styles.categoryRow, { backgroundColor: pressed ? colors.surfaceMuted : 'transparent', borderTopColor: colors.separator }]}
              >
                <CategoryIcon icon={category.icon} color={category.colorHex} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: colors.text, fontWeight: '500' }]}>{category.name}</Text>
                  <View style={[styles.shareTrack, { backgroundColor: colors.chartTrack }]}>
                    <View style={{ width: `${Math.max(2, category.share * 100)}%`, height: 4, borderRadius: 2, backgroundColor: category.colorHex }} />
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[type.body, { color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{money(category.totalMinor, data.currency)}</Text>
                  <Text style={[type.caption, { color: colors.textSecondary }]}>
                    {percent(category.share)} · {category.count}
                  </Text>
                </View>
              </Pressable>
            ))}
          </Card>

          <SectionLabel>Daily spending</SectionLabel>
          <Card>
            <DailyBars month={month} byDay={data.byDay} currency={data.currency} />
          </Card>

          {data.topMerchants.length > 0 ? (
            <>
              <SectionLabel>Top merchants</SectionLabel>
              <Card padded={false}>
                {data.topMerchants.slice(0, 5).map((m, i) => (
                  <View key={m.normalized} style={[styles.merchantRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
                    <Text style={[type.body, { color: colors.textTertiary, width: 20, fontVariant: ['tabular-nums'] }]}>{i + 1}</Text>
                    <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                      {m.merchant}
                    </Text>
                    <Text style={[type.footnote, { color: colors.textSecondary }]}>{m.count}×</Text>
                    <Text style={[type.body, { color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{money(m.totalMinor, data.currency)}</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  currencies: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  donutWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  shareTrack: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  merchantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
