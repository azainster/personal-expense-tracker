/** Category drill-down for one month (§7 Step 6). */
import type { CategoryRow } from '@expense/core';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CategoryIcon, TransactionListRow } from '@/components/finance';
import { EmptyState, ErrorView, LoadingView } from '@/components/states';
import { Card, Divider, Screen } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { monthLabel } from '@/lib/configHelpers';
import { money } from '@/lib/format';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';

export default function CategoryDetail() {
  const { key, month, currency } = useLocalSearchParams<{ key: string; month: string; currency?: string }>();
  const { colors } = useTheme();
  const { state } = useApp();

  const { data, error, loading, reload } = useStoreQuery(
    async ({ store }) => {
      const [list, categories] = await Promise.all([
        store.listTransactions({ month: String(month), categoryKey: String(key), includeExcluded: false, limit: 1000 }),
        store.listCategories(),
      ]);
      const rows = currency ? list.rows.filter((r) => r.currencyCode === currency) : list.rows;
      return { rows, categories };
    },
    [key, month, currency],
  );

  const category: CategoryRow | undefined = useMemo(() => data?.categories.find((c) => c.key === key), [data, key]);
  const total = useMemo(() => (data?.rows ?? []).reduce((sum, t) => sum + (t.isCredit ? -t.amountMinor : t.amountMinor), 0), [data]);
  const title = category?.name ?? (key === 'uncategorized' ? 'Uncategorized' : 'Category');
  const currentMonth = state.services?.store.currentMonth();

  if (error) return <ErrorView fullScreen message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView />;

  return (
    <Screen topInset={false}>
      <Stack.Screen options={{ title }} />
      <Card style={styles.summary}>
        <CategoryIcon icon={category?.icon} color={category?.colorHex} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={[type.subhead, { color: colors.textSecondary }]}>{monthLabel(String(month), currentMonth)}</Text>
          <Text style={[type.title, { color: colors.text, fontVariant: ['tabular-nums'] }]}>{money(total, currency ?? data.rows[0]?.currencyCode ?? 'INR')}</Text>
          <Text style={[type.footnote, { color: colors.textSecondary }]}>
            {data.rows.length} {data.rows.length === 1 ? 'transaction' : 'transactions'}
          </Text>
        </View>
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState icon="pricetag-outline" title="Nothing here" message="No counted transactions in this category this month." />
      ) : (
        <Card padded={false}>
          {data.rows.map((tx, i) => (
            <View key={tx.id}>
              {i > 0 ? <Divider inset={64} /> : null}
              <TransactionListRow tx={tx} category={category} showDate onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
});
