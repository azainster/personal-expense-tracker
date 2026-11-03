/** Parser lab: run any sample email — or one you paste — through the real cascade. */
import { SAMPLE_EMAILS } from '@expense/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Group, Row } from '@/components/settings';
import { Button, Card, Pill, Screen, SectionLabel } from '@/components/ui';
import { setPendingTrace } from '@/lib/pendingTrace';
import { radius, spacing, type, useTheme } from '@/theme';

export default function ParserLab() {
  const { colors } = useTheme();
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const inputStyle = [type.body, styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted }];
  const canRun = from.trim() !== '' && body.trim() !== '';

  return (
    <Screen topInset={false} keyboardShouldPersistTaps="handled">
      <Text style={[type.subhead, { color: colors.textSecondary, lineHeight: 20, paddingHorizontal: spacing.xs }]}>
        Everything runs on this iPhone and nothing is saved. Use it to see why an email was, or wasn’t, turned into an expense.
      </Text>

      <SectionLabel>Paste an email</SectionLabel>
      <Card style={{ gap: spacing.sm }}>
        <TextInput
          value={from}
          onChangeText={setFrom}
          placeholder="From, e.g. HDFC Bank <alerts@hdfcbank.net>"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
          accessibilityLabel="Sender"
        />
        <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={colors.textTertiary} style={inputStyle} accessibilityLabel="Subject" />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Email text (or HTML)"
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[inputStyle, { minHeight: 140, textAlignVertical: 'top' }]}
          accessibilityLabel="Email body"
        />
        <Button
          title="Parse"
          icon="flask"
          disabled={!canRun}
          onPress={() => {
            setPendingTrace({ from, subject, body });
            router.push({ pathname: '/trace', params: { source: 'pasted' } });
          }}
        />
      </Card>

      <Group title={`Sample emails (${SAMPLE_EMAILS.length})`} footer="The hand-labelled golden corpus the parser is tested against.">
        {SAMPLE_EMAILS.map((fixture) => (
          <Row
            key={fixture.id}
            label={fixture.id}
            detail={fixture.from.replace(/<.*>/, '').trim()}
            onPress={() => router.push({ pathname: '/trace', params: { fixtureId: fixture.id } })}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Pill label={fixture.expected.status === 'parsed' ? 'expense' : 'noise'} tone={fixture.expected.status === 'parsed' ? 'positive' : 'neutral'} />
              </View>
            }
          />
        ))}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
});
