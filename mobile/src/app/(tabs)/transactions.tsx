/** Every transaction, grouped by day, searchable, with a "needs review" queue. */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CategoryRow, TransactionRow } from '@expense/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TransactionListRow } from '@/components/finance';
import { EmptyState, ErrorView, InlineLoading } from '@/components/states';
import { Button, Divider, LargeTitle, Pill } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { dayHeading, localDayKey, money } from '@/lib/format';
import { sourceDisplay, trackedSources } from '@/lib/sources';
import { useApp } from '@/state/AppState';
import { radius, spacing, type, useTheme } from '@/theme';

type Filter = 'all' | 'review' | 'excluded';
const PAGE = 200;

export default function Transactions() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useApp();
  const params = useLocalSearchParams<{ filter?: string; source?: string }>();
  const [filter, setFilter] = useState<Filter>(params.filter === 'review' ? 'review' : 'all');
  /** null = every account. Set from the dashboard's account cards via the `source` param. */
  const [sourceKey, setSourceKey] = useState<string | null>(params.source ?? null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [refreshing, setRefreshing] = useState(false);

  // Arriving from "N expenses need a quick check" switches to the review queue, even if the
  // tab was already open on another filter. Derived during render, not in an effect.
  const [seenParam, setSeenParam] = useState(params.filter);
  if (params.filter !== seenParam) {
    setSeenParam(params.filter);
    if (params.filter === 'review') setFilter('review');
  }

  // Same for an account arriving from a dashboard card.
  const [seenSource, setSeenSource] = useState(params.source);
  if (params.source !== seenSource) {
    setSeenSource(params.source);
    setSourceKey(params.source ?? null);
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, reload } = useStoreQuery(
    async ({ store }) => {
      const [list, categories] = await Promise.all([
        store.listTransactions({
          search: debounced,
          needsReview: filter === 'review',
          includeExcluded: true,
          limit: filter === 'excluded' ? 1000 : limit,
          ...(sourceKey ? { sourceKey } : {}),
        }),
        store.listCategories(),
      ]);
      const rows = filter === 'excluded' ? list.rows.filter((r) => r.isExcludedFromTotals) : list.rows;
      return { rows, total: filter === 'excluded' ? rows.length : list.total, categories };
    },
    [debounced, filter, limit, sourceKey],
  );

  const categoryMap = useMemo(() => new Map<string, CategoryRow>((data?.categories ?? []).map((c) => [c.key, c])), [data]);

  const sections = useMemo(() => {
    const groups = new Map<string, TransactionRow[]>();
    for (const tx of data?.rows ?? []) {
      const key = localDayKey(tx.occurredAt);
      const list = groups.get(key);
      if (list) list.push(tx);
      else groups.set(key, [tx]);
    }
    return [...groups.entries()].map(([day, items]) => {
      const counted = items.filter((t) => !t.isExcludedFromTotals);
      const currencies = new Set(counted.map((t) => t.currencyCode));
      // Never add amounts across currencies; a mixed day simply shows no total.
      const spent = currencies.size === 1 ? counted.reduce((sum, t) => sum + (t.isCredit ? -t.amountMinor : t.amountMinor), 0) : 0;
      return { title: dayHeading(day), day, data: items, spent, currency: counted[0]?.currencyCode ?? 'INR' };
    });
  }, [data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (state.account) await actions.syncNow('auto');
      else reload();
    } finally {
      setRefreshing(false);
    }
  }, [actions, reload, state.account]);

  const header = (
    <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.md }}>
      <LargeTitle
        title="Transactions"
        subtitle={
          data
            ? `${sourceKey ? `${sourceDisplay(sourceKey).label} · ` : ''}${data.total} ${data.total === 1 ? 'transaction' : 'transactions'}`
            : null
        }
      />
      <View style={[styles.search, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="search" size={17} color={colors.textTertiary} />
        <TextInput
          value={search}
          onChangeText={(text) => {
            setSearch(text);
            setLimit(PAGE);
          }}
          placeholder="Search merchants and notes"
          placeholderTextColor={colors.textTertiary}
          style={[type.body, { flex: 1, color: colors.text, paddingVertical: 8 }]}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search transactions"
        />
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        <Pill label="All accounts" tone={sourceKey === null ? 'accent' : 'neutral'} onPress={() => setSourceKey(null)} />
        {trackedSources().map((source) => (
          <Pill
            key={source.key}
            label={source.shortLabel}
            tone={sourceKey === source.key ? 'accent' : 'neutral'}
            onPress={() => setSourceKey(source.key)}
          />
        ))}
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        <Pill label="All" tone={filter === 'all' ? 'accent' : 'neutral'} onPress={() => setFilter('all')} />
        <Pill label={`Needs review${state.reviewCount > 0 ? ` (${state.reviewCount})` : ''}`} tone={filter === 'review' ? 'warning' : 'neutral'} onPress={() => setFilter('review')} />
        <Pill label="Not counted" tone={filter === 'excluded' ? 'accent' : 'neutral'} onPress={() => setFilter('excluded')} />
      </View>
    </View>
  );

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <ErrorView message={error} onRetry={reload} />
      </View>
    );
  }

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.background }}
      sections={sections}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={[type.footnote, { color: colors.textSecondary, fontWeight: '600' }]}>{section.title}</Text>
          {section.spent > 0 ? <Text style={[type.footnote, { color: colors.textSecondary, fontVariant: ['tabular-nums'] }]}>{money(section.spent, section.currency)}</Text> : null}
        </View>
      )}
      renderItem={({ item, index, section }) => (
        <View
          style={{
            marginHorizontal: spacing.lg,
            backgroundColor: colors.surface,
            borderTopLeftRadius: index === 0 ? radius.md : 0,
            borderTopRightRadius: index === 0 ? radius.md : 0,
            borderBottomLeftRadius: index === section.data.length - 1 ? radius.md : 0,
            borderBottomRightRadius: index === section.data.length - 1 ? radius.md : 0,
            overflow: 'hidden',
          }}
        >
          {index > 0 ? <Divider inset={64} /> : null}
          <TransactionListRow tx={item} category={item.categoryKey ? categoryMap.get(item.categoryKey) : undefined} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })} />
        </View>
      )}
      ListEmptyComponent={
        loading ? (
          <InlineLoading label="Loading…" />
        ) : debounced ? (
          <EmptyState icon="search-outline" title="No matches" message={`Nothing matches “${debounced}”.`} />
        ) : filter === 'review' ? (
          <EmptyState icon="checkmark-done-outline" title="All caught up" message="Nothing needs a second look right now." />
        ) : filter === 'excluded' ? (
          <EmptyState icon="swap-horizontal-outline" title="Nothing excluded" message="Transfers, income and anything you hide from totals show up here." />
        ) : (
          <EmptyState icon="receipt-outline" title="No transactions yet" message={state.account ? 'New expenses appear here after each sync.' : 'Connect Gmail or load demo data from Overview.'}>
            {!state.account ? <Button title="Connect Gmail" icon="logo-google" onPress={() => router.push('/connect')} /> : null}
          </EmptyState>
        )
      }
      ListFooterComponent={
        data && filter !== 'excluded' && data.rows.length < data.total ? (
          <View style={{ padding: spacing.lg }}>
            <Button title="Show more" variant="secondary" onPress={() => setLimit((l) => l + PAGE)} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md },
  filters: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
});
