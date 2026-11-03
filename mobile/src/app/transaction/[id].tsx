/** Transaction detail: recategorize, confirm, notes, exclude, merged duplicates, source email (§7 Step 6). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CategoryIcon } from '@/components/finance';
import { Group, Row, SwitchRow } from '@/components/settings';
import { Banner, EmptyState, ErrorView, LoadingView } from '@/components/states';
import { Button, Card, Pill, Screen } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { userMessage } from '@/lib/errors';
import { longDate, methodLabel, money } from '@/lib/format';
import { sourceDisplay, txnKindLabel, UNKNOWN_SOURCE_KEY } from '@/lib/sources';
import { useApp } from '@/state/AppState';
import { radius, spacing, type, useTheme } from '@/theme';

function gmailWebLink(accountEmail: string | null, messageId: string): string {
  const account = accountEmail ? encodeURIComponent(accountEmail) : '0';
  return `https://mail.google.com/mail/u/${account}/#all/${encodeURIComponent(messageId)}`;
}

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { state, actions } = useApp();
  const [notes, setNotes] = useState('');
  const notesLoadedFor = useRef<string | null>(null);

  const { data, error, loading, reload } = useStoreQuery(
    async ({ store }) => {
      const [tx, categories] = await Promise.all([store.getTransaction(String(id)), store.listCategories()]);
      const duplicates = tx ? await store.listDuplicateLinks(tx.id) : [];
      return { tx, categories, duplicates };
    },
    [id],
  );

  useEffect(() => {
    if (data?.tx && notesLoadedFor.current !== data.tx.id) {
      notesLoadedFor.current = data.tx.id;
      setNotes(data.tx.notes ?? '');
    }
  }, [data]);

  if (error) return <ErrorView fullScreen message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView />;
  if (!data.tx) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <EmptyState icon="trash-outline" title="Transaction not found" message="It may have been deleted." />
      </View>
    );
  }

  const tx = data.tx;
  const store = state.services?.store;
  const category = data.categories.find((c) => c.key === tx.categoryKey);
  const source = sourceDisplay(tx.sourceKey);
  const isDemo = tx.source === 'sample';

  const update = async (fields: Parameters<NonNullable<typeof store>['updateTransactionFields']>[1], toast?: string) => {
    if (!store) return;
    try {
      await store.updateTransactionFields(tx.id, fields);
      actions.notifyDataChanged();
      if (toast) actions.showToast({ message: toast, tone: 'success' });
    } catch (err) {
      Alert.alert('Couldn’t save', userMessage(err));
    }
  };

  const saveNotes = () => {
    if ((tx.notes ?? '') !== notes) update({ notes });
  };

  const confirmDelete = () => {
    Alert.alert('Delete this transaction?', 'It disappears from your totals. If the same email is read again by a full re-sync, it may come back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!store) return;
          await store.deleteTransaction(tx.id);
          actions.notifyDataChanged();
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen topInset={false} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: tx.merchantDisplay }} />

      <Card style={styles.hero}>
        <CategoryIcon icon={category?.icon} color={category?.colorHex} size={56} />
        <Text style={[type.title, { color: colors.text, textAlign: 'center' }]} selectable>
          {tx.merchantDisplay}
        </Text>
        <Text
          style={[type.hero, { color: tx.isCredit ? colors.positive : colors.text, fontVariant: ['tabular-nums'] }]}
          accessibilityLabel={`${tx.isCredit ? 'Credit' : 'Spent'} ${money(tx.amountMinor, tx.currencyCode)}`}
        >
          {tx.isCredit ? '+' : ''}
          {money(tx.amountMinor, tx.currencyCode)}
        </Text>
        <Text style={[type.subhead, { color: colors.textSecondary }]}>{longDate(tx.occurredAt)}</Text>
        <View style={styles.pills}>
          <Pill label={category?.name ?? 'Uncategorized'} tone="accent" icon="pricetag" onPress={() => router.push({ pathname: '/categorize/[id]', params: { id: tx.id } })} />
          {source.key !== UNKNOWN_SOURCE_KEY ? (
            <Pill label={source.shortLabel} icon={source.kind === 'credit_card' ? 'card' : 'business'} />
          ) : null}
          {tx.txnKind === 'transfer' ? <Pill label="Transfer" icon="swap-horizontal" /> : null}
          {tx.txnKind === 'refund' ? <Pill label="Refund" tone="positive" icon="return-down-back" /> : null}
          {tx.txnKind === 'credit' ? <Pill label={tx.categoryKey === 'income' ? 'Income' : 'Money in'} tone="positive" /> : null}
          {tx.isExcludedFromTotals ? <Pill label="Not counted" /> : null}
          {tx.isUserConfirmed ? <Pill label="Confirmed" tone="positive" icon="checkmark" /> : null}
          {isDemo ? <Pill label="Demo" icon="sparkles" /> : null}
        </View>
      </Card>

      {tx.needsReview ? (
        <Banner
          tone="warning"
          icon="alert-circle-outline"
          title="Does this look right?"
          message={`We were ${Math.round(tx.confidence * 100)}% sure about this one. Confirm it, or fix the category.`}
        >
          <View style={styles.reviewActions}>
            <Button compact title="Looks right" icon="checkmark" onPress={() => update({ needsReview: false, isUserConfirmed: true }, 'Marked as correct.')} />
            <Button compact variant="secondary" title="Change category" onPress={() => router.push({ pathname: '/categorize/[id]', params: { id: tx.id } })} />
          </View>
        </Banner>
      ) : null}

      <Group>
        <Row label="Category" value={category?.name ?? 'Uncategorized'} onPress={() => router.push({ pathname: '/categorize/[id]', params: { id: tx.id } })} />
        <SwitchRow
          label="Count in spending"
          detail={tx.isTransfer ? 'Transfers between your own accounts are not spending.' : undefined}
          value={!tx.isExcludedFromTotals}
          onValueChange={(counted) => update({ isExcludedFromTotals: !counted })}
        />
      </Group>

      <Group title="Notes">
        <View style={{ padding: spacing.md }}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            onBlur={saveNotes}
            onSubmitEditing={saveNotes}
            placeholder="Add a note"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={2000}
            style={[type.body, styles.notes, { color: colors.text, backgroundColor: colors.surfaceMuted }]}
            accessibilityLabel="Notes"
          />
        </View>
      </Group>

      <Group title="Details">
        <Row label="Account" value={source.key === UNKNOWN_SOURCE_KEY ? (tx.accountLabel ?? 'Not identified') : source.label} />
        {tx.accountLast4 ? <Row label="Card / account" value={`•••• ${tx.accountLast4}`} /> : null}
        {tx.counterpartyVpa ? <Row label="Paid to (UPI)" value={tx.counterpartyVpa} multilineValue /> : null}
        <Row label="Type" value={txnKindLabel(tx.txnKind)} />
        {tx.txnTime ? <Row label="Time" value={tx.txnTime} /> : null}
        {tx.referenceId ? <Row label="Reference" value={tx.referenceId} /> : null}
        <Row label="From" value={tx.senderAddress} />
        {tx.merchantRaw && tx.merchantRaw !== tx.merchantDisplay ? <Row label="As written" value={tx.merchantRaw} multilineValue /> : null}
        <Row label="Read by" value={methodLabel(tx.extractionMethod)} />
        <Row label="Confidence" value={`${Math.round(tx.confidence * 100)}%`} detail={tx.confidenceReasons.length > 0 ? tx.confidenceReasons.join(' · ') : null} />
        <Row label="Parser version" value={tx.parserVersion} />
      </Group>

      {data.duplicates.length > 0 ? (
        <Group title="Merged emails" footer="The same purchase was reported more than once. It is counted once.">
          {data.duplicates.map((d) => (
            <Row
              key={d.duplicateMessageId}
              label={d.duplicateMerchant ?? 'Duplicate email'}
              detail={`${d.duplicateSender ?? 'unknown sender'} · ${d.matchKind.replace('-', ' ')} · ${Math.round(d.similarity * 100)}% match`}
            />
          ))}
        </Group>
      ) : null}

      <Group title="Source">
        {isDemo ? (
          <Row label="Demo email" detail="This expense came from the bundled sample corpus" />
        ) : (
          <Row
            label="Open email in Gmail"
            icon="open-outline"
            iconColor="#D93025"
            onPress={() => WebBrowser.openBrowserAsync(gmailWebLink(state.account?.email ?? state.lastAccountEmail, tx.gmailMessageId)).catch(() => undefined)}
          />
        )}
        <Row
          label="Show how this was read"
          icon="flask-outline"
          iconColor="#E0813E"
          detail={isDemo ? undefined : 'Re-reads the email from Gmail. Nothing is stored.'}
          disabled={!isDemo && (!state.account || !state.online)}
          onPress={() =>
            router.push({
              pathname: '/trace',
              params: isDemo ? { fixtureId: tx.gmailMessageId.replace(/^sample-/, '') } : { messageId: tx.gmailMessageId },
            })
          }
        />
      </Group>

      <Pressable onPress={confirmDelete} accessibilityRole="button" style={styles.delete}>
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
        <Text style={[type.body, { color: colors.danger }]}>Delete transaction</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xs },
  reviewActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  notes: { minHeight: 72, borderRadius: radius.sm, padding: spacing.md, textAlignVertical: 'top' },
  delete: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
});
