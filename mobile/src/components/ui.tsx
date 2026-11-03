/** Core building blocks: screen containers, cards, buttons, pills, progress. */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, type, useTheme } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  refreshControl,
  contentStyle,
  keyboardShouldPersistTaps,
  topInset = true,
}: {
  children: ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  /** Tab screens draw their own large title under the status bar; pushed screens have a nav bar. */
  topInset?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        { paddingTop: topInset ? insets.top + spacing.sm : spacing.md, paddingBottom: spacing.xxl + insets.bottom, paddingHorizontal: spacing.lg, gap: spacing.lg },
        contentStyle,
      ]}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  );
}

export function LargeTitle({ title, subtitle, right }: { title: string; subtitle?: string | null; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[type.largeTitle, { color: colors.text }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[type.subhead, { color: colors.textSecondary, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface }, padded && { padding: spacing.lg }, style]}>{children}</View>;
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionLabel}>
      <Text style={[type.footnote, { color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' }]}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  accessibilityHint,
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string }> = {
    primary: { bg: colors.accent, fg: '#FFFFFF' },
    secondary: { bg: colors.accentMuted, fg: colors.accent },
    plain: { bg: 'transparent', fg: colors.accent },
    destructive: { bg: colors.dangerMuted, fg: colors.danger },
  };
  const { bg, fg } = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: inactive ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={fg} /> : null}
          <Text style={[type.headline, { color: fg, fontSize: compact ? 15 : 17 }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, disabled }: { icon: IconName; onPress: () => void; label: string; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={colors.accent} />
    </Pressable>
  );
}

export type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

export function useToneColors(tone: Tone): { fg: string; bg: string } {
  const { colors } = useTheme();
  switch (tone) {
    case 'accent':
      return { fg: colors.accent, bg: colors.accentMuted };
    case 'positive':
      return { fg: colors.positive, bg: colors.positiveMuted };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningMuted };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerMuted };
    default:
      return { fg: colors.textSecondary, bg: colors.surfaceMuted };
  }
}

export function Pill({ label, tone = 'neutral', icon, onPress }: { label: string; tone?: Tone; icon?: IconName; onPress?: () => void }) {
  const { fg, bg } = useToneColors(tone);
  const content = (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[type.caption, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      {content}
    </Pressable>
  );
}

export function ProgressBar({ progress }: { progress: number | null }) {
  const { colors } = useTheme();
  const width = progress === null ? '35%' : `${Math.max(4, Math.min(100, progress * 100))}%`;
  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.chartTrack }]} accessibilityRole="progressbar">
      <View style={[styles.progressFill, { backgroundColor: colors.accent, width: width as `${number}%` }]} />
    </View>
  );
}

export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const { colors } = useTheme();
  return (
    <Text style={[type.footnote, { color: colors.textSecondary }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.xs },
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  sectionLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: -spacing.sm, paddingHorizontal: spacing.xs },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonCompact: { minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
});
