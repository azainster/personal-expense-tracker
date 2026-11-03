/**
 * The parse trace (§7 Step 2: "Debug screen dumping raw parsed text. You will live in it."):
 * which cascade stage answered, every scored amount candidate with its reasons, and the plain
 * text the parser actually worked on. Rendered from memory — nothing here is stored.
 */
import type { ParseResult } from '@expense/core';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { money, methodLabel } from '@/lib/format';
import { spacing, type, useTheme } from '@/theme';
import { Group, Row } from './settings';
import { Card, Pill, SectionLabel } from './ui';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function TraceView({ result, matchedSender }: { result: ParseResult; matchedSender: string | null }) {
  const { colors } = useTheme();
  const { debug } = result;

  return (
    <View style={{ gap: spacing.lg }}>
      {result.status === 'parsed' ? (
        <Group title="Result">
          <Row label="Status" right={<Pill label="Transaction" tone="positive" icon="checkmark" />} />
          <Row label="Amount" value={`${result.transaction.isCredit ? 'Credit ' : ''}${money(result.transaction.amountMinor, result.transaction.currencyCode)}`} />
          <Row label="Merchant" value={result.transaction.merchantDisplay} detail={`normalized: ${result.transaction.merchantNormalized} · raw: ${result.transaction.merchantRaw}`} />
          <Row label="Category" value={result.transaction.categoryKey} detail={`source: ${result.transaction.categorySource}`} />
          <Row label="Method" value={methodLabel(result.transaction.extractionMethod)} />
          <Row label="Confidence" value={`${Math.round(result.transaction.confidence * 100)}%`} detail={result.transaction.needsReview ? 'Below the review threshold' : null} />
          <Row label="Date" value={result.transaction.occurredAt.toISOString().slice(0, 10)} detail={debug.dateSource ? `from ${debug.dateSource}` : null} />
          {result.transaction.accountLast4 ? <Row label="Card / account" value={`•••• ${result.transaction.accountLast4}`} /> : null}
          {result.transaction.isTransfer ? <Row label="Transfer" value="Yes — excluded from spending" /> : null}
        </Group>
      ) : (
        <Group title="Result">
          <Row label="Status" right={<Pill label="Not a transaction" tone="warning" icon="close" />} />
          <Row label="Reason" value={result.reason} multilineValue />
          <Row label="Stopped at" value={result.stageReached} />
          <Row label="Subject shape" value={result.subjectShape} detail="What telemetry records instead of the subject" />
        </Group>
      )}

      <Group title="Cascade">
        <Row label="Sender rule" value={matchedSender ?? 'none (unknown sender)'} />
        {debug.templateId ? <Row label="Template" value={debug.templateId} /> : null}
        {debug.stages.map((stage, i) => (
          <Row key={i} label={`Stage ${i + 1}`} value={stage} multilineValue />
        ))}
      </Group>

      <SectionLabel>Amount candidates</SectionLabel>
      <Card padded={false}>
        {debug.amountCandidates.length === 0 ? (
          <Text style={[type.subhead, { color: colors.textSecondary, padding: spacing.lg }]}>No money-like spans found.</Text>
        ) : (
          debug.amountCandidates.map((c, i) => (
            <View key={i} style={[styles.candidate, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}>
              <View style={styles.candidateHead}>
                <Text style={[type.headline, { color: colors.text, fontVariant: ['tabular-nums'] }]}>{money(c.minorUnits, c.currency)}</Text>
                <Pill label={`score ${c.score.toFixed(1)}`} tone={i === 0 ? 'accent' : 'neutral'} />
              </View>
              <Text style={[type.footnote, { color: colors.textSecondary, fontFamily: MONO }]}>“{c.raw}”</Text>
              {c.reasons.length > 0 ? <Text style={[type.caption, { color: colors.textTertiary, lineHeight: 17 }]}>{c.reasons.join(' · ')}</Text> : null}
            </View>
          ))
        )}
      </Card>

      <SectionLabel>Text the parser saw ({debug.textLength} chars)</SectionLabel>
      <Card>
        <Text selectable style={{ fontFamily: MONO, fontSize: 12, lineHeight: 17, color: colors.text }}>
          {debug.cleanedText || '(empty)'}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  candidate: { padding: spacing.lg, gap: 4 },
  candidateHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
