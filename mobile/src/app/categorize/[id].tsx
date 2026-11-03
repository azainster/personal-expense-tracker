/**
 * Recategorize (§4): one tap, applied retroactively to every transaction from the merchant,
 * remembered permanently, with "Recategorized 14 past transactions — Undo".
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { MERCHANT_FROM_SENDER_REASON } from '@expense/core';
import { CategoryIcon } from '@/components/finance';
import { ErrorView, LoadingView } from '@/components/states';
import { Card, Screen } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { userMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';

export default function Categorize() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { state, actions } = useApp();
  const [saving, setSaving] = useState<string | null>(null);

  const { data, error, loading, reload } = useStoreQuery(
    async ({ store }) => {
      const [tx, categories] = await Promise.all([store.getTransaction(String(id)), store.listCategories()]);
      const sameMerchant = tx ? (await store.listTransactions({ search: undefined, includeExcluded: true, limit: 1000 })).rows.filter((r) => r.merchantNormalized === tx.merchantNormalized).length : 0;
      return { tx, categories, sameMerchant };
    },
    [id],
  );

  if (error) return <ErrorView fullScreen message={error} onRetry={reload} />;
  if (loading || !data?.tx) return <LoadingView />;
  const tx = data.tx;
  // A name guessed from the sender is shared by every unparsed alert from that bank, so the
  // change cannot be applied to "the merchant".
  const merchantFromSender = tx.confidenceReasons.includes(MERCHANT_FROM_SENDER_REASON);

  const choose = async (categoryKey: string) => {
    const store = state.services?.store;
    if (!store || saving) return;
    if (categoryKey === tx.categoryKey) {
      router.back();
      return;
    }
    setSaving(categoryKey);
    try {
      const result = await store.recategorize(tx.id, categoryKey);
      const name = data.categories.find((c) => c.key === categoryKey)?.name ?? categoryKey;
      actions.notifyDataChanged();
      router.back();
      actions.showToast({
        message:
          result.scope === 'transaction'
            ? `Moved to ${name}. This transaction only — the email didn’t name a merchant.`
            : result.retroactivelyUpdated > 0
              ? `Moved to ${name}. Recategorized ${result.retroactivelyUpdated} past ${tx.merchantDisplay} ${result.retroactivelyUpdated === 1 ? 'transaction' : 'transactions'}.`
              : `Moved to ${name}. Future ${tx.merchantDisplay} expenses will be too.`,
        actionLabel: 'Undo',
        onAction: async () => {
          await store.undoRecategorize(result.undo);
          actions.notifyDataChanged();
        },
      });
    } catch (err) {
      Alert.alert('Couldn’t change the category', userMessage(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Screen topInset={false}>
      <Text style={[type.subhead, { color: colors.textSecondary, lineHeight: 20, paddingHorizontal: spacing.xs }]}>
        {merchantFromSender
          ? `This email didn’t name a merchant, so “${tx.merchantDisplay}” is just who sent it. The category applies to this transaction only.`
          : data.sameMerchant > 1
            ? `Applies to all ${data.sameMerchant} ${tx.merchantDisplay} transactions, and to future ones.`
            : `Future ${tx.merchantDisplay} transactions will use this category too.`}
      </Text>
      <Card padded={false}>
        {data.categories.map((category, index) => {
          const selected = category.key === tx.categoryKey;
          return (
            <Pressable
              key={category.key}
              onPress={() => choose(category.key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, busy: saving === category.key }}
              accessibilityLabel={`${category.name}${category.excludedFromTotals ? ', not counted in spending' : ''}`}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
              ]}
            >
              <CategoryIcon icon={category.icon} color={category.colorHex} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: colors.text }]}>{category.name}</Text>
                {category.excludedFromTotals ? <Text style={[type.caption, { color: colors.textTertiary }]}>Not counted in spending</Text> : null}
              </View>
              {saving === category.key ? (
                <ActivityIndicator color={colors.textSecondary} />
              ) : selected ? (
                <Ionicons name="checkmark" size={22} color={colors.accent} />
              ) : null}
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 56 },
});
