/** Settings: Gmail connection, sync, data, parsing (rules pack, AI fallback), privacy, about. */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { PARSER_VERSION } from '@expense/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Group, Row, SwitchRow } from '@/components/settings';
import { LargeTitle, Screen } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { relativeTime } from '@/lib/configHelpers';
import { userMessage } from '@/lib/errors';
import { checkApiHealth, type ProxyHealth } from '@/lib/llm';
import { activeRulesPack, refreshRulesPack } from '@/lib/rulesPack';
import { useApp } from '@/state/AppState';
import { spacing, type, useTheme } from '@/theme';

export default function Settings() {
  const { colors } = useTheme();
  const { state, actions } = useApp();
  const [health, setHealth] = useState<ProxyHealth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesVersion, setRulesVersion] = useState(activeRulesPack().version);

  useEffect(() => {
    if (!appConfig.api.configured) return;
    let cancelled = false;
    checkApiHealth().then((h) => {
      if (!cancelled) setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      Alert.alert('Something went wrong', userMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect Gmail?',
      'Access is revoked at Google and the sign-in is removed from this iPhone’s Keychain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect, keep expenses',
          onPress: () =>
            run('disconnect', async () => {
              await actions.disconnect({ wipeData: false });
              actions.showToast({ message: 'Gmail disconnected. Your expenses are still here.' });
            }),
        },
        {
          text: 'Disconnect and delete expenses',
          style: 'destructive',
          onPress: () =>
            run('disconnect', async () => {
              await actions.disconnect({ wipeData: true });
              router.replace('/onboarding');
            }),
        },
      ],
    );
  };

  const confirmErase = () => {
    Alert.alert('Erase everything?', 'Deletes every expense, category change and setting on this iPhone and disconnects Gmail. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Erase everything',
        style: 'destructive',
        onPress: () =>
          run('erase', async () => {
            await actions.eraseEverything();
            router.replace('/onboarding');
          }),
      },
    ]);
  };

  const llmAvailable = appConfig.api.configured && health?.llmProxyAvailable === true;
  const llmDetail = !appConfig.api.configured
    ? 'Not available in this build (no API server configured).'
    : health === null
      ? 'Checking the server…'
      : !health.reachable
        ? 'The server can’t be reached right now.'
        : !health.llmProxyAvailable
          ? 'Not enabled on the server.'
          : 'For emails the on-device parser can’t read. Account numbers, card numbers, names, emails and links are removed first. Off by default.';

  const lastRun = state.sync.lastRun;
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
  const build = Application.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber ?? '—';
  const spinner = (key: string) => (busy === key ? <ActivityIndicator color={colors.textSecondary} /> : undefined);

  return (
    <Screen>
      <LargeTitle title="Settings" />

      <Group
        title="Gmail"
        footer={state.account ? 'Read-only access. Emails are processed on this iPhone and never stored.' : 'Connect to import expenses from receipts and bank alerts.'}
      >
        {state.account ? (
          <Row label="Connected account" value={state.account.email} icon="mail" iconColor="#D93025" />
        ) : state.needsReauth ? (
          <Row label="Reconnect Gmail" detail={state.lastAccountEmail ?? 'Google ended the connection'} icon="key" iconColor={colors.danger} onPress={() => router.push('/connect')} />
        ) : (
          <Row label="Connect Gmail" icon="logo-google" iconColor="#4285F4" onPress={() => router.push('/connect')} />
        )}
        {state.account ? (
          <Row
            label={state.sync.running ? 'Syncing…' : 'Sync now'}
            detail={lastRun ? `Last sync ${relativeTime(lastRun.finishedAt ?? lastRun.startedAt)} · ${lastRun.status}` : 'Not synced yet'}
            icon="refresh"
            iconColor={colors.accent}
            onPress={() => actions.syncNow('auto')}
            disabled={state.sync.running || !state.online}
            right={state.sync.running ? <ActivityIndicator color={colors.textSecondary} /> : undefined}
          />
        ) : null}
        <Row label="Sync activity" detail="Runs, skipped senders, parse failures" icon="pulse" iconColor="#8E6FC4" onPress={() => router.push('/activity')} />
        {state.account ? <Row label="Disconnect Gmail" destructive onPress={confirmDisconnect} right={spinner('disconnect')} /> : null}
      </Group>

      <Group title="Parsing">
        <Row
          label="Sender rules"
          value={rulesVersion}
          detail={appConfig.api.configured ? 'Bank and merchant templates, updated without an app release' : 'Bundled with this build'}
          icon="document-text"
          iconColor="#4FA3A3"
          onPress={
            appConfig.api.configured && state.services
              ? () =>
                  run('rules', async () => {
                    const store = state.services?.store;
                    if (!store) return;
                    const result = await refreshRulesPack(store, { force: true });
                    setRulesVersion(result.version);
                    if (result.status === 'updated') actions.notifyDataChanged();
                    actions.showToast({
                      message:
                        result.status === 'updated'
                          ? `Rules updated to ${result.version}.`
                          : result.status === 'current'
                            ? 'Rules are up to date.'
                            : 'Couldn’t check for rule updates right now.',
                    });
                  })
              : undefined
          }
          right={spinner('rules')}
        />
        <SwitchRow
          label="AI fallback"
          detail={llmDetail}
          value={state.llmEnabled && llmAvailable}
          disabled={!llmAvailable}
          onValueChange={(enabled) => run('llm', () => actions.setLlmEnabled(enabled))}
          icon="sparkles"
          iconColor="#C4567F"
        />
        <Row label="Parser lab" detail="See exactly how an email is read" icon="flask" iconColor="#E0813E" onPress={() => router.push('/parser-lab')} />
      </Group>

      <Group title="Data">
        {state.demoCount > 0 ? (
          <Row
            label="Remove demo data"
            detail={`${state.demoCount} sample transactions`}
            icon="sparkles-outline"
            iconColor="#7A7A7A"
            onPress={() =>
              run('demo', async () => {
                await actions.clearDemo();
                actions.showToast({ message: 'Demo data removed.' });
              })
            }
            right={spinner('demo')}
          />
        ) : !state.account ? (
          <Row
            label="Load demo data"
            detail="Sample emails, parsed by the real pipeline"
            icon="sparkles-outline"
            iconColor="#7A7A7A"
            onPress={() => run('demo', actions.loadDemo)}
            right={spinner('demo')}
          />
        ) : null}
        <Row label="Privacy" detail="What is read, what is kept, where it lives" icon="shield-checkmark" iconColor={colors.positive} onPress={() => router.push('/privacy')} />
        <Row label="Erase everything" destructive onPress={confirmErase} right={spinner('erase')} />
      </Group>

      <Group title="About">
        <Row label="Version" value={`${version} (${build})`} />
        <Row label="Parser" value={PARSER_VERSION} />
        {appConfig.api.configured ? (
          <Row label="Server" value={health === null ? 'Checking…' : health.reachable ? 'Reachable' : 'Unreachable'} detail={appConfig.api.url} />
        ) : null}
      </Group>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={[type.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
          {appConfig.appName} · {appConfig.appEnv}
        </Text>
      </View>
    </Screen>
  );
}
