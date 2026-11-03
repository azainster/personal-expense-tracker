/**
 * Sync activity: recent runs, content-free parse-failure telemetry (sender domain + stage only)
 * and senders discovered by the Tier-2 sweep (§2.2, §5 ParseFailure).
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Group, Row } from '@/components/settings';
import { ErrorView, LoadingView } from '@/components/states';
import { Button, Pill, Screen } from '@/components/ui';
import { useStoreQuery } from '@/hooks/useStoreQuery';
import { relativeTime } from '@/lib/configHelpers';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';

const STATUS_TONE = { completed: 'positive', partial: 'warning', failed: 'danger', running: 'accent' } as const;

export default function Activity() {
  const { colors } = useTheme();
  const { state, actions } = useApp();
  const [running, setRunning] = useState<string | null>(null);

  const { data, error, loading, reload } = useStoreQuery(
    async ({ store }) => {
      const [runs, failures, senders] = await Promise.all([store.listSyncRuns(15), store.parseFailureSummary(20), store.listDiscoveredSenders()]);
      return { runs, failures, senders };
    },
    [],
  );

  if (error) return <ErrorView fullScreen message={error} onRetry={reload} />;
  if (loading || !data) return <LoadingView />;

  const trigger = async (kind: 'discovery' | 'backfill') => {
    setRunning(kind);
    try {
      const summary = await actions.syncNow(kind);
      if (summary) {
        actions.showToast({
          message: `Checked ${summary.listed} emails · ${summary.created} new · ${summary.duplicates} merged${summary.complete ? '' : ' · will continue'}`,
        });
      }
    } finally {
      setRunning(null);
    }
  };

  return (
    <Screen topInset={false}>
      {state.account ? (
        <View style={{ gap: spacing.sm }}>
          <Button
            title="Look for new senders"
            icon="search"
            variant="secondary"
            loading={running === 'discovery'}
            disabled={state.sync.running || !state.online}
            onPress={() => trigger('discovery')}
            accessibilityHint="Runs the broader discovery sweep over the last 35 days"
          />
          <Button title="Re-scan last 35 days" variant="plain" loading={running === 'backfill'} disabled={state.sync.running || !state.online} onPress={() => trigger('backfill')} />
        </View>
      ) : null}

      <Group title="Recent syncs" footer={data.runs.length === 0 ? undefined : 'A paused sync picks up where it stopped — iOS limits how long the app may run in the background.'}>
        {data.runs.length === 0 ? (
          <Row label="No syncs yet" detail={state.account ? 'Pull down on Overview to sync.' : 'Connect Gmail to start syncing.'} />
        ) : (
          data.runs.map((run) => (
            <Row
              key={run.id}
              label={`${run.kind === 'auto' ? 'Sync' : run.kind.charAt(0).toUpperCase() + run.kind.slice(1)} · ${relativeTime(run.startedAt)}`}
              detail={
                run.status === 'failed'
                  ? (run.errorMessage ?? 'Failed')
                  : `${run.listed} found · ${run.created} new · ${run.duplicates} merged · ${run.skipped} skipped · ${run.failed} not expenses`
              }
              right={<Pill label={run.status} tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? 'neutral'} />}
            />
          ))
        )}
      </Group>

      <Group title="Emails that weren’t expenses" footer="Only the sender’s domain and the stage reached are recorded — never the subject or the email itself.">
        {data.failures.length === 0 ? (
          <Row label="Nothing recorded" />
        ) : (
          data.failures.map((f) => <Row key={f.senderDomain} label={f.senderDomain} detail={`last stopped at ${f.lastStage}`} value={`${f.count}`} />)
        )}
      </Group>

      <Group title="Senders seen" footer="Senders that produce expenses reliably are added to the precise daily search automatically.">
        {data.senders.length === 0 ? (
          <Row label="None yet" />
        ) : (
          data.senders.slice(0, 30).map((s) => (
            <Row key={s.address} label={s.address} detail={`${s.success} expenses · ${s.failure} other`} right={s.success >= 2 ? <Pill label="tracked" tone="positive" /> : undefined} />
          ))
        )}
      </Group>

      <Text style={[type.caption, { color: colors.textTertiary, textAlign: 'center' }]}>Parse results are never uploaded.</Text>
    </Screen>
  );
}
