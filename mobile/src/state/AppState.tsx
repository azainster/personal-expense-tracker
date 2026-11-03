/**
 * App-wide state and the actions that change it. Screens read data straight from the store
 * (see useStoreQuery) and re-query whenever `dataVersion` changes.
 */
import * as Network from 'expo-network';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';
import { ReauthRequiredError, type SyncKind, type SyncProgress, type SyncRunRow, type SyncSummary } from '@expense/core';
import { connectGmail, disconnectGmail, getConnectedAccount, onReauthRequired, type ConnectedAccount } from '@/lib/auth';
import { registerBackgroundSync, unregisterBackgroundSync } from '@/lib/backgroundSync';
import { appConfig } from '@/lib/config';
import { AuthCancelledError, NetworkUnavailableError, userMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { refreshRulesPack } from '@/lib/rulesPack';
import {
  clearDemoData,
  getServices,
  isLlmEnabled,
  loadDemoData,
  runSync,
  setLlmEnabled as persistLlmEnabled,
  SETTING_ONBOARDED,
  wipeLocalData,
  type Services,
} from '@/lib/services';

const log = createLogger('app');

export interface ToastMessage {
  id: number;
  message: string;
  tone?: 'default' | 'success' | 'danger';
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

export interface SyncUiState {
  running: boolean;
  progress: SyncProgress | null;
  lastRun: SyncRunRow | null;
  lastError: string | null;
}

export interface AppStateValue {
  phase: 'booting' | 'ready' | 'failed';
  bootError: string | null;
  services: Services | null;
  onboarded: boolean;
  account: ConnectedAccount | null;
  /** Credentials were rejected (revoked, expired). `lastAccountEmail` keeps the address for the prompt. */
  needsReauth: boolean;
  lastAccountEmail: string | null;
  demoCount: number;
  reviewCount: number;
  sync: SyncUiState;
  llmEnabled: boolean;
  dataVersion: number;
  online: boolean;
  toast: ToastMessage | null;
}

export interface AppActions {
  retryBoot(): void;
  finishOnboarding(): Promise<void>;
  /** Resolves 'cancelled' if the person closed Google's sheet; throws with a readable message otherwise. */
  connect(): Promise<'connected' | 'cancelled'>;
  disconnect(options: { wipeData: boolean }): Promise<void>;
  syncNow(kind?: SyncKind): Promise<SyncSummary | null>;
  loadDemo(): Promise<void>;
  clearDemo(): Promise<void>;
  eraseEverything(): Promise<void>;
  setLlmEnabled(enabled: boolean): Promise<void>;
  notifyDataChanged(): void;
  showToast(toast: Omit<ToastMessage, 'id'>): void;
  dismissToast(): void;
}

const Ctx = createContext<{ state: AppStateValue; actions: AppActions } | null>(null);

const INITIAL: AppStateValue = {
  phase: 'booting',
  bootError: null,
  services: null,
  onboarded: false,
  account: null,
  needsReauth: false,
  lastAccountEmail: null,
  demoCount: 0,
  reviewCount: 0,
  sync: { running: false, progress: null, lastRun: null, lastError: null },
  llmEnabled: false,
  dataVersion: 0,
  online: true,
  toast: null,
};

function syncIsDue(lastRun: SyncRunRow | null): boolean {
  if (!lastRun) return true;
  if (lastRun.status !== 'completed') return true;
  const finished = lastRun.finishedAt ? new Date(lastRun.finishedAt).getTime() : 0;
  return !Number.isFinite(finished) || Date.now() - finished > appConfig.sync.autoSyncAfterMinutes * 60_000;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppStateValue>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;
  const toastCounter = useRef(0);
  const [bootAttempt, setBootAttempt] = useState(0);

  const refreshCounts = useCallback(async (services: Services) => {
    const [demoCount, review, lastRun] = await Promise.all([
      services.store.countTransactions('sample'),
      services.store.listTransactions({ needsReview: true, includeExcluded: true, limit: 1 }),
      services.store.latestSyncRun(),
    ]);
    setState((s) => ({ ...s, demoCount, reviewCount: review.total, sync: { ...s.sync, lastRun } }));
  }, []);

  const notifyDataChanged = useCallback(() => {
    setState((s) => ({ ...s, dataVersion: s.dataVersion + 1 }));
    const services = stateRef.current.services;
    if (services) refreshCounts(services).catch(() => undefined);
  }, [refreshCounts]);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    toastCounter.current += 1;
    setState((s) => ({ ...s, toast: { ...toast, id: toastCounter.current } }));
  }, []);

  const dismissToast = useCallback(() => setState((s) => ({ ...s, toast: null })), []);

  const syncNow = useCallback(
    async (kind: SyncKind = 'auto'): Promise<SyncSummary | null> => {
      const current = stateRef.current;
      // I leave the UI untouched when there is no connected account; the connect screen owns that flow.
      if (!current.services || !current.account) return null;
      if (!current.online) {
        setState((s) => ({ ...s, sync: { ...s.sync, lastError: new NetworkUnavailableError().message } }));
        return null;
      }
      setState((s) => ({ ...s, sync: { ...s.sync, running: true, progress: null, lastError: null } }));
      let lastProcessed = -1;
      try {
        const summary = await runSync(kind, {
          onProgress: (progress) => {
            setState((s) => {
              const changed = progress.processed !== lastProcessed && progress.phase === 'fetching';
              if (changed) lastProcessed = progress.processed;
              return { ...s, sync: { ...s.sync, progress }, dataVersion: changed ? s.dataVersion + 1 : s.dataVersion };
            });
          },
        });
        setState((s) => ({ ...s, needsReauth: false, sync: { ...s.sync, running: false, progress: null }, dataVersion: s.dataVersion + 1 }));
        await refreshCounts(current.services);
        return summary;
      } catch (err) {
        const reauth = err instanceof ReauthRequiredError;
        log.warn('sync failed', { reauth });
        setState((s) => ({
          ...s,
          needsReauth: reauth ? true : s.needsReauth,
          account: reauth ? null : s.account,
          lastAccountEmail: reauth ? (s.account?.email ?? s.lastAccountEmail) : s.lastAccountEmail,
          sync: { ...s.sync, running: false, progress: null, lastError: reauth ? null : userMessage(err) },
          dataVersion: s.dataVersion + 1,
        }));
        await refreshCounts(current.services).catch(() => undefined);
        return null;
      }
    },
    [refreshCounts],
  );

  // ── Boot ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const services = await getServices();
        const [onboarded, account] = await Promise.all([services.store.getSetting(SETTING_ONBOARDED), getConnectedAccount()]);
        if (cancelled) return;
        setState((s) => ({
          ...s,
          phase: 'ready',
          bootError: null,
          services,
          onboarded: onboarded === 'true' || account !== null,
          account,
          llmEnabled: isLlmEnabled(),
        }));
        await refreshCounts(services);
        if (account) {
          registerBackgroundSync().catch(() => undefined);
          if (syncIsDue(await services.store.latestSyncRun())) {
            // I let the first frame render before starting automatic network work.
            setTimeout(() => syncNow('auto').catch(() => undefined), 300);
          }
        }
        refreshRulesPack(services.store)
          .then((result) => {
            if (result.status === 'updated') notifyDataChanged();
          })
          .catch(() => undefined);
      } catch (err) {
        // Always leave 'booting' on failure: the root layout hides the splash once the phase
        // settles, and shows the error screen with Retry.
        log.error('boot failed', { err: err instanceof Error ? err.message : 'unknown' });
        if (!cancelled) setState((s) => ({ ...s, phase: 'failed', bootError: userMessage(err) }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootAttempt, notifyDataChanged, refreshCounts, syncNow]);

  // ── Credentials revoked while running ─────────────────────────────────────────
  useEffect(
    () =>
      onReauthRequired(() => {
        setState((s) => ({ ...s, needsReauth: true, lastAccountEmail: s.account?.email ?? s.lastAccountEmail, account: null }));
      }),
    [],
  );

  // ── Connectivity ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const apply = (isConnected: boolean | undefined, reachable: boolean | null | undefined) => {
      const online = isConnected !== false && reachable !== false;
      setState((s) => (s.online === online ? s : { ...s, online }));
    };
    Network.getNetworkStateAsync()
      .then((n) => apply(n.isConnected, n.isInternetReachable))
      .catch(() => undefined);
    try {
      const sub = Network.addNetworkStateListener((n) => apply(n.isConnected, n.isInternetReachable));
      return () => sub.remove();
    } catch {
      return undefined;
    }
  }, []);

  // ── Foreground auto-sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      const s = stateRef.current;
      if (s.phase !== 'ready' || !s.account || s.sync.running) return;
      if (syncIsDue(s.sync.lastRun)) syncNow('auto').catch(() => undefined);
    });
    return () => sub.remove();
  }, [syncNow]);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const finishOnboarding = useCallback(async () => {
    const services = stateRef.current.services;
    if (services) await services.store.setSetting(SETTING_ONBOARDED, 'true');
    setState((s) => ({ ...s, onboarded: true }));
  }, []);

  const connect = useCallback(async (): Promise<'connected' | 'cancelled'> => {
    if (!stateRef.current.online) throw new NetworkUnavailableError();
    let account: ConnectedAccount;
    try {
      account = await connectGmail();
    } catch (err) {
      if (err instanceof AuthCancelledError) return 'cancelled';
      throw new Error(userMessage(err));
    }
    const services = stateRef.current.services;
    if (services) {
      // Demo rows must not sit next to real ones.
      await clearDemoData();
      await services.store.setSetting(SETTING_ONBOARDED, 'true');
    }
    setState((s) => ({ ...s, account, needsReauth: false, lastAccountEmail: account.email, onboarded: true, demoCount: 0 }));
    stateRef.current = { ...stateRef.current, account };
    registerBackgroundSync().catch(() => undefined);
    notifyDataChanged();
    setTimeout(() => syncNow('auto').catch(() => undefined), 200);
    return 'connected';
  }, [notifyDataChanged, syncNow]);

  const disconnect = useCallback(
    async ({ wipeData }: { wipeData: boolean }) => {
      await disconnectGmail();
      await unregisterBackgroundSync();
      if (wipeData) await wipeLocalData();
      setState((s) => ({
        ...s,
        account: null,
        needsReauth: false,
        lastAccountEmail: null,
        onboarded: wipeData ? false : s.onboarded,
        llmEnabled: wipeData ? false : s.llmEnabled,
        sync: { running: false, progress: null, lastRun: wipeData ? null : s.sync.lastRun, lastError: null },
      }));
      notifyDataChanged();
    },
    [notifyDataChanged],
  );

  const loadDemo = useCallback(async () => {
    await loadDemoData();
    notifyDataChanged();
  }, [notifyDataChanged]);

  const clearDemo = useCallback(async () => {
    await clearDemoData();
    notifyDataChanged();
  }, [notifyDataChanged]);

  const eraseEverything = useCallback(async () => {
    if (stateRef.current.account || stateRef.current.needsReauth) await disconnectGmail().catch(() => undefined);
    await unregisterBackgroundSync();
    await wipeLocalData();
    setState((s) => ({
      ...INITIAL,
      phase: 'ready',
      services: s.services,
      online: s.online,
      dataVersion: s.dataVersion + 1,
    }));
  }, []);

  const setLlmEnabled = useCallback(async (enabled: boolean) => {
    await persistLlmEnabled(enabled);
    setState((s) => ({ ...s, llmEnabled: enabled }));
  }, []);

  const retryBoot = useCallback(() => {
    setState((s) => ({ ...s, phase: 'booting', bootError: null }));
    setBootAttempt((n) => n + 1);
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      retryBoot,
      finishOnboarding,
      connect,
      disconnect,
      syncNow,
      loadDemo,
      clearDemo,
      eraseEverything,
      setLlmEnabled,
      notifyDataChanged,
      showToast,
      dismissToast,
    }),
    [retryBoot, finishOnboarding, connect, disconnect, syncNow, loadDemo, clearDemo, eraseEverything, setLlmEnabled, notifyDataChanged, showToast, dismissToast],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): { state: AppStateValue; actions: AppActions } {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
