/** Grouped, iOS-style list rows used by Settings, detail screens and the sync activity log. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { radius, spacing, type, useTheme } from '@/theme';
import { Divider, type IconName } from './ui';

export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ gap: spacing.xs }}>
      {title ? (
        <Text style={[type.footnote, styles.groupTitle, { color: colors.textSecondary }]} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surface }]}>
        {items.map((child, index) => (
          <View key={index}>
            {index > 0 ? <Divider inset={spacing.lg} /> : null}
            {child}
          </View>
        ))}
      </View>
      {footer ? <Text style={[type.footnote, styles.footer, { color: colors.textSecondary }]}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  label,
  value,
  icon,
  iconColor,
  onPress,
  destructive,
  detail,
  right,
  disabled,
  accessibilityHint,
  multilineValue,
}: {
  label: string;
  value?: string | null;
  icon?: IconName;
  iconColor?: string;
  onPress?: () => void;
  destructive?: boolean;
  detail?: string | null;
  right?: ReactNode;
  disabled?: boolean;
  accessibilityHint?: string;
  multilineValue?: boolean;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.row, { opacity: disabled ? 0.45 : 1 }]}>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: iconColor ?? colors.accent }]}>
          <Ionicons name={icon} size={16} color="#FFFFFF" />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: destructive ? colors.danger : colors.text }]}>{label}</Text>
        {detail ? <Text style={[type.footnote, { color: colors.textSecondary }]}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text
          style={[type.body, { color: colors.textSecondary, maxWidth: multilineValue ? '65%' : '55%', textAlign: 'right' }]}
          numberOfLines={multilineValue ? 3 : 1}
          selectable
        >
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={value ? `${label}: ${value}` : label}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceMuted : 'transparent' })}
    >
      {content}
    </Pressable>
  );
}

export function SwitchRow({
  label,
  detail,
  value,
  onValueChange,
  disabled,
  icon,
  iconColor,
}: {
  label: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  icon?: IconName;
  iconColor?: string;
}) {
  const { colors } = useTheme();
  return (
    <Row
      label={label}
      detail={detail}
      icon={icon}
      iconColor={iconColor}
      disabled={disabled}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: colors.positive, false: colors.chartTrack }}
          accessibilityLabel={label}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.md, overflow: 'hidden' },
  groupTitle: { textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing.lg, fontWeight: '500' },
  footer: { paddingHorizontal: spacing.lg, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 48 },
  rowIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
});
