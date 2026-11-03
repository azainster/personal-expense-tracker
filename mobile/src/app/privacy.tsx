/** Plain-language privacy summary (§6 App Store 5.1.2, Google API Services User Data Policy). */
import { Text, View } from 'react-native';
import { Card, Screen } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { spacing, type, useTheme } from '@/theme';

function Section({ title, children }: { title: string; children: string }) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={[type.headline, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[type.callout, { color: colors.textSecondary, lineHeight: 22 }]}>{children}</Text>
    </Card>
  );
}

export default function Privacy() {
  const { colors } = useTheme();
  return (
    <Screen topInset={false}>
      <Section title="What the app reads">
        With your permission, the app uses Google’s read-only Gmail access to search for receipts, bank alerts and payment confirmations. Access
        is read-only: it cannot send, delete or change email.
      </Section>
      <Section title="Where it happens">
        Emails are downloaded to this iPhone, read in memory to extract the amount, merchant and date, and then discarded. Email contents are never
        written to storage and never uploaded to our servers.
      </Section>
      <Section title="What is kept, and where">
        Each expense (amount, merchant, date, category, the card’s last four digits when the bank shows them) and the Gmail message ID, so you
        can open the original. It lives in an encrypted database inside the app on this iPhone. Your Google sign-in is kept in the iOS Keychain,
        on this device only. There is no account with us.
      </Section>
      <Section title="The optional AI fallback">
        Off unless you turn it on. When an email can’t be read on the device, a shortened copy with account numbers, card numbers, names, email
        addresses, street addresses and links removed is sent through our server to Anthropic’s Claude model to extract the expense. Our server
        does not store or log it.
      </Section>
      <Section title="Google API data">
        The app’s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the
        Limited Use requirements. Gmail data is used only to show you your expenses, is never used for advertising, and is never sold or shared.
      </Section>
      <Section title="Your control">
        Disconnect Gmail in Settings to revoke access at Google. “Erase everything” deletes all data from this iPhone. Deleting the app removes it
        too. You can also remove access at myaccount.google.com/permissions.
      </Section>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[type.caption, { color: colors.textTertiary, textAlign: 'center' }]}>{appConfig.appName}</Text>
      </View>
    </Screen>
  );
}
