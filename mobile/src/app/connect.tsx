/**
 * Pre-consent explainer (§6: "Pre-consent explainer screen in your own UI"). Google's consent
 * screen is alarming by design for gmail.readonly; say plainly what happens before it appears.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banner } from '@/components/states';
import { Button, type IconName } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { useApp } from '@/state/AppState';
import { radius, spacing, type, useTheme } from '@/theme';

function Line({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={20} color={color} style={{ marginTop: 1 }} />
      <Text style={[type.callout, { color: colors.text, flex: 1, lineHeight: 21 }]}>{text}</Text>
    </View>
  );
}

export default function Connect() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useApp();
  const [busy, setBusy] = useState(false);
  const problem = appConfig.google.problem;

  const start = async () => {
    setBusy(true);
    try {
      const outcome = await actions.connect();
      if (outcome === 'connected') {
        router.dismissAll();
        router.replace('/(tabs)');
      }
    } catch (err) {
      Alert.alert('Couldn’t connect Gmail', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.title, { color: colors.text }]} accessibilityRole="header">
          {state.needsReauth ? 'Reconnect your Gmail' : 'Before Google asks'}
        </Text>
        <Text style={[type.body, { color: colors.textSecondary, lineHeight: 22 }]}>
          Next, Google shows its sign-in sheet. Because this app reads email, Google words the permission strongly — here is exactly what it
          is used for.
        </Text>

        {state.demoCount > 0 ? (
          <Banner tone="accent" icon="information-circle-outline" title="Demo data will be removed" message="Your real expenses replace the sample ones once Gmail is connected." />
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[type.headline, { color: colors.text }]}>The app will</Text>
          <Line icon="checkmark-circle" color={colors.positive} text="Look for receipts, bank alerts and payment confirmations from the last 35 days, then new ones as they arrive." />
          <Line icon="checkmark-circle" color={colors.positive} text="Read those emails on this iPhone to pull out the amount, merchant and date." />
          <Line icon="checkmark-circle" color={colors.positive} text="Keep only the extracted expense and a link back to the email." />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[type.headline, { color: colors.text }]}>The app will never</Text>
          <Line icon="close-circle" color={colors.danger} text="Send, delete, move or label any email. Access is read-only." />
          <Line icon="close-circle" color={colors.danger} text="Store email contents, or upload your mail to a server." />
          <Line icon="close-circle" color={colors.danger} text="Share or sell anything, or use your data for ads." />
        </View>

        <Text style={[type.footnote, { color: colors.textSecondary, lineHeight: 18 }]}>
          On Google’s screen, keep “View your email messages and settings” ticked. While the app is in Google’s testing mode, Google may ask
          you to reconnect about once a week — that is expected. You can disconnect at any time in Settings.
        </Text>

        {problem ? <Banner tone="warning" icon="construct-outline" title="Setup needed" message={problem} /> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          title={state.online ? 'Continue to Google' : 'You’re offline'}
          icon="logo-google"
          onPress={start}
          loading={busy}
          disabled={!!problem || !state.online}
          accessibilityHint="Opens Google’s secure sign-in sheet"
        />
        <Button title="Not now" variant="plain" onPress={() => router.back()} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.lg },
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  line: { flexDirection: 'row', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.xs },
});
