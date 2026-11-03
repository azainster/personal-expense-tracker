/**
 * The app's engine room, created once per process (foreground app or background task):
 * the on-device store, the active rules pack, the Gmail client and the sync engine.
 */
import * as Crypto from 'expo-crypto';
import {
  allFixtureEmails,
  GmailClient,
  ingestMessages,
  SqlStore,
  SyncEngine,
  type IngestStats,
  type LlmProvider,
  type SyncKind,
  type SyncRunOptions,
  type SyncSummary,
} from '@expense/core';
import { appConfig } from './config';
import { openDriver } from './database';
import { getAccessToken, invalidateAccessToken, isConnected } from './auth';
import { createProxyLlmProvider } from './llm';
import { createLogger } from './logger';
import { activeRulesPack, initRulesPack, reseedRules } from './rulesPack';

const log = createLogger('services');

export const SETTING_LLM_ENABLED = 'llm_fallback_enabled';
export const SETTING_ONBOARDED = 'onboarding_complete';

export interface Services {
  store: SqlStore;
  engine: SyncEngine;
  gmail: GmailClient;
  llm: LlmProvider;
}

let servicesPromise: Promise<Services> | null = null;
let llmEnabled = false;

async function create(): Promise<Services> {
  const driver = await openDriver();
  const store = new SqlStore(driver, {
    newId: () => Crypto.randomUUID(),
    utcOffsetMinutes: () => -new Date().getTimezoneOffset(),
  });
  await store.migrate();
  await initRulesPack(store);
  await store.markStaleRunsFailed();
  llmEnabled = (await store.getSetting(SETTING_LLM_ENABLED)) === 'true';

  const gmail = new GmailClient({
    getAccessToken,
    invalidateAccessToken,
    logger: createLogger('gmail'),
    // Gentler than the server's ceiling: one person's inbox, on a phone radio.
    requestsPerSecond: 20,
  });
  const llm = createProxyLlmProvider();

  const engine = new SyncEngine({
    store,
    gmail,
    rulesPack: activeRulesPack,
    settings: () => ({
      windowDays: appConfig.sync.windowDays,
      maxMessagesPerRun: appConfig.sync.maxMessagesPerRun,
      discoverySweepHours: appConfig.sync.discoverySweepHours,
      defaultCurrency: appConfig.defaultCurrency,
      localeHint: appConfig.localeHint,
    }),
    llm: () => (llmEnabled && appConfig.api.configured ? llm : null),
    logger: createLogger('sync'),
    isConnected,
  });

  log.info('services ready');
  return { store, engine, gmail, llm };
}

export function getServices(): Promise<Services> {
  if (!servicesPromise) {
    servicesPromise = create().catch((err) => {
      servicesPromise = null;
      throw err;
    });
  }
  return servicesPromise;
}

export async function setLlmEnabled(enabled: boolean): Promise<void> {
  const { store } = await getServices();
  await store.setSetting(SETTING_LLM_ENABLED, enabled ? 'true' : 'false');
  llmEnabled = enabled;
}

export function isLlmEnabled(): boolean {
  return llmEnabled;
}

export async function runSync(kind: SyncKind, options: SyncRunOptions = {}): Promise<SyncSummary> {
  const { engine } = await getServices();
  return engine.run(kind, options);
}

/** §6 demo mode: the bundled corpus, through the real parser — for App Review and first look. */
export async function loadDemoData(): Promise<IngestStats> {
  const { store } = await getServices();
  await store.deleteBySource('sample');
  return ingestMessages(allFixtureEmails(), {
    store,
    pack: activeRulesPack(),
    defaultCurrency: appConfig.defaultCurrency,
    localeHint: appConfig.localeHint,
    logger: createLogger('demo'),
  });
}

export async function clearDemoData(): Promise<number> {
  const { store } = await getServices();
  return store.deleteBySource('sample');
}

/** Deletes every transaction, rule, telemetry row and setting on this device. */
export async function wipeLocalData(): Promise<void> {
  const { store } = await getServices();
  await store.wipeAll();
  await reseedRules(store);
  llmEnabled = false;
}
