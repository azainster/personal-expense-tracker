/** Bottom toast with an optional action — used for "Recategorized 14 past transactions — Undo" (§4). */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/state/AppState';
import { radius, spacing, type } from '@/theme';

const VISIBLE_MS = 6500;

export function ToastHost() {
  const { state, actions } = useApp();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const toast = state.toast;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => actions.dismissToast(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast, actions]);

  if (!toast) return null;
  const background = toast.tone === 'danger' ? '#B3261E' : '#1F2329';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 64 }]}>
      <View style={[styles.toast, { backgroundColor: background }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Text style={[type.callout, styles.message]}>{toast.message}</Text>
        {toast.actionLabel && toast.onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={toast.actionLabel}
            disabled={busy}
            hitSlop={8}
            onPress={async () => {
              setBusy(true);
              try {
                await toast.onAction?.();
              } finally {
                setBusy(false);
                actions.dismissToast();
              }
            }}
          >
            <Text style={[type.headline, { color: '#8AB4FF', fontSize: 15, opacity: busy ? 0.5 : 1 }]}>{toast.actionLabel}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={actions.dismissToast} hitSlop={8}>
            <Text style={[type.headline, { color: '#C9CED6', fontSize: 15 }]}>OK</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  message: { color: '#FFFFFF', flex: 1, lineHeight: 20 },
});
