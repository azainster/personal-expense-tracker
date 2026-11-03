/**
 * First launch. §2.1 incremental auth: show value first and never ask for Gmail on the very
 * first screen without explaining why — the consent warning is the biggest funnel drop.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, type IconName } from '@/components/ui';
import { userMessage } from '@/lib/errors';
import { useApp } from '@/state/AppState';
import { radius, spacing, type, useTheme } from '@/theme';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'mail-open-outline',
    title: 'Reads the receipts you already get',
    body: 'Bank alerts, card spends, UPI payments and order confirmations become a clean expense list.',
  },
  {
    icon: 'layers-outline',
    title: 'Counts every purchase once',
    body: 'The bank alert, the receipt and the payment app email for one coffee are merged, not tripled.',
  },
  {
    icon: 'lock-closed-outline',
    title: 'Stays on your iPhone',
    body: 'Emails are read on the device and never stored. There is no account and no server holding your mail.',
  },
];

export default function Onboarding() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { actions } = useApp();
  const [loadingDemo, setLoadingDemo] = useState(false);

  const exploreDemo = async () => {
    setLoadingDemo(true);
    try {
      await actions.loadDemo();
      await actions.finishOnboarding();
      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Could not load demo data', userMessage(err));
    } finally {
      setLoadingDemo(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xxl }]}>
        <View style={[styles.logo, { backgroundColor: colors.accent }]}>
          <Ionicons name="receipt-outline" size={40} color="#FFFFFF" />
        </View>
        <Text style={[type.largeTitle, styles.heading, { color: colors.text }]} accessibilityRole="header">
          Your spending, straight from your inbox
        </Text>
        <Text style={[type.body, { color: colors.textSecondary, textAlign: 'center', lineHeight: 22 }]}>
          No bank logins and no typing. Connect Gmail once and your expenses sort themselves.
        </Text>

        <View style={[styles.points, { backgroundColor: colors.surface }]}>
          {POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <View style={[styles.pointIcon, { backgroundColor: colors.accentMuted }]}>
                <Ionicons name={point.icon} size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.headline, { color: colors.text }]}>{point.title}</Text>
                <Text style={[type.subhead, { color: colors.textSecondary, lineHeight: 19 }]}>{point.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg, backgroundColor: colors.background }]}>
        <Button title="Connect Gmail" icon="logo-google" onPress={() => router.push('/connect')} />
        <Button title="Explore with demo data" variant="secondary" onPress={exploreDemo} loading={loadingDemo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg, alignItems: 'stretch' },
  logo: { width: 80, height: 80, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  heading: { textAlign: 'center', marginTop: spacing.sm },
  points: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.lg, marginTop: spacing.sm },
  point: { flexDirection: 'row', gap: spacing.md },
  pointIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
});
