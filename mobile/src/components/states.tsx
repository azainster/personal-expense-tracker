/** Loading, empty, error and banner states — every screen uses these instead of ad-hoc text. */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useTheme } from '@/theme';
import { Button, useToneColors, type IconName, type Tone } from './ui';

export function LoadingView({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]} accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator size="large" color={colors.textSecondary} />
      {label ? <Text style={[type.subhead, { color: colors.textSecondary, marginTop: spacing.md }]}>{label}</Text> : null}
    </View>
  );
}

export function InlineLoading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.inline}>
      <ActivityIndicator color={colors.textSecondary} />
      {label ? <Text style={[type.subhead, { color: colors.textSecondary }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: IconName;
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name={icon} size={30} color={colors.textSecondary} />
      </View>
      <Text style={[type.title, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center', lineHeight: 21 }]}>{message}</Text> : null}
      {children ? <View style={styles.emptyActions}>{children}</View> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry, fullScreen }: { message: string; onRetry?: () => void; fullScreen?: boolean }) {
  const { colors } = useTheme();
  const body = (
    <EmptyState icon="alert-circle-outline" title="Something went wrong" message={message}>
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="secondary" icon="refresh" /> : null}
    </EmptyState>
  );
  if (!fullScreen) return body;
  return <View style={[styles.center, { backgroundColor: colors.background, padding: spacing.xl }]}>{body}</View>;
}

export function Banner({
  tone,
  icon,
  title,
  message,
  actionLabel,
  onAction,
  children,
}: {
  tone: Tone;
  icon: IconName;
  title: string;
  message?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const { fg, bg } = useToneColors(tone);
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="summary">
      <Ionicons name={icon} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: colors.text, fontSize: 15 }]}>{title}</Text>
        {message ? <Text style={[type.footnote, { color: colors.textSecondary, lineHeight: 18 }]}>{message}</Text> : null}
        {children}
        {actionLabel && onAction ? (
          <Text
            style={[type.headline, { color: fg, fontSize: 15, marginTop: spacing.xs }]}
            onPress={onAction}
            accessibilityRole="button"
            suppressHighlighting
          >
            {actionLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  empty: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  emptyActions: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md },
  banner: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
});
