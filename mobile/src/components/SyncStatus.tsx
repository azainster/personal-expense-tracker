/** The status strip on Overview: reconnect, offline, syncing progress, errors, demo mode. */
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { relativeTime } from '@/lib/configHelpers';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';
import { Banner } from './states';
import { Card, ProgressBar } from './ui';

export function SyncStatus() {
  const { state, actions } = useApp();
  const { colors } = useTheme();
  const { sync } = state;

  if (state.needsReauth) {
    return (
      <Banner
        tone="danger"
        icon="key-outline"
        title="Reconnect Gmail"
        message={`Google ended the connection${state.lastAccountEmail ? ` for ${state.lastAccountEmail}` : ''}. Your expenses are safe; reconnect to keep them up to date.`}
        actionLabel="Reconnect"
        onAction={() => router.push('/connect')}
      />
    );
  }

  if (sync.running) {
    const p = sync.progress;
    const fraction = p && p.phase === 'fetching' && p.total > 0 ? p.processed / p.total : null;
    const label =
      !p || p.phase === 'starting'
        ? 'Connecting to Gmail…'
        : p.phase === 'history'
          ? 'Checking for new email…'
          : p.phase === 'listing'
            ? `Finding transaction emails… ${p.listed > 0 ? `(${p.listed})` : ''}`
            : p.phase === 'fetching'
              ? p.total === 0
                ? 'Everything is up to date'
                : `Reading emails ${p.processed} of ${p.total}`
              : 'Finishing up…';
    return (
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.subhead, { color: colors.text, fontWeight: '600' }]} accessibilityLiveRegion="polite">
            {label}
          </Text>
          {p && p.created > 0 ? <Text style={[type.subhead, { color: colors.positive }]}>+{p.created} new</Text> : null}
        </View>
        <ProgressBar progress={fraction} />
      </Card>
    );
  }

  if (!state.online && state.account) {
    return <Banner tone="warning" icon="cloud-offline-outline" title="You’re offline" message="Showing what’s already on this iPhone. New expenses sync when you’re back online." />;
  }

  if (sync.lastError && state.account) {
    return (
      <Banner
        tone="warning"
        icon="warning-outline"
        title="Last sync didn’t finish"
        message={sync.lastError}
        actionLabel="Try again"
        onAction={() => actions.syncNow('auto')}
      />
    );
  }

  if (state.demoCount > 0 && !state.account) {
    return (
      <Banner
        tone="accent"
        icon="sparkles-outline"
        title="You’re looking at demo data"
        message="These sample emails went through the real parser. Connect Gmail to see your own spending."
        actionLabel="Connect Gmail"
        onAction={() => router.push('/connect')}
      />
    );
  }

  if (state.account && sync.lastRun) {
    const partial = sync.lastRun.status === 'partial';
    return (
      <Text style={[type.footnote, { color: colors.textSecondary, paddingHorizontal: spacing.xs }]}>
        {partial ? 'Sync paused — continues automatically · ' : 'Synced '}
        {relativeTime(sync.lastRun.finishedAt ?? sync.lastRun.startedAt)} · pull down to refresh
      </Text>
    );
  }

  return null;
}
