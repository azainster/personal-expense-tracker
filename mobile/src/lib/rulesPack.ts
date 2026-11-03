/**
 * Rules pack — §1(A). The pack bundled in the build is always the floor; a newer, validated
 * pack from the API (fetched at most daily, ETag-conditional) replaces it without an App
 * Store release. A pack that fails validation is ignored, never half-applied.
 */
import {
  compareRulesPackVersions,
  parseRulesPack,
  type RulesPack,
  type SqlStore,
} from '@expense/core';
import bundledRulesPackJson from '@expense/core/rules/rules-pack.json';
import { appConfig } from './config';
import { fetchWithTimeout } from './http';
import { createLogger } from './logger';

const log = createLogger('rules');

const KEY_JSON = 'rules_pack_json';
const KEY_ETAG = 'rules_pack_etag';
const KEY_CHECKED = 'rules_pack_checked_at';
const KEY_SEEDED = 'rules_pack_seeded_version';
const CHECK_INTERVAL_MS = 24 * 3600_000;

let bundled: RulesPack | null = null;
let active: RulesPack | null = null;

/**
 * Parsed on first use, not at import: if the bundled pack were ever invalid, the failure
 * surfaces through app boot (error screen with Retry) instead of crashing module loading
 * before any UI exists.
 */
function bundledPack(): RulesPack {
  if (!bundled) bundled = parseRulesPack(bundledRulesPackJson);
  return bundled;
}

export function activeRulesPack(): RulesPack {
  return active ?? bundledPack();
}

export function bundledRulesPackVersion(): string {
  return bundledPack().version;
}

/** Picks the newest valid pack (bundled vs cached download) and seeds categories + dictionary. */
export async function initRulesPack(store: SqlStore): Promise<RulesPack> {
  const base = bundledPack();
  const cachedJson = await store.getSetting(KEY_JSON);
  let chosen = base;
  if (cachedJson) {
    try {
      const cached = parseRulesPack(JSON.parse(cachedJson));
      if (compareRulesPackVersions(cached.version, base.version) > 0) chosen = cached;
    } catch (err) {
      log.warn('cached rules pack is invalid; using the bundled pack', { err: err instanceof Error ? err.message : 'unknown' });
      await store.deleteSetting(KEY_JSON);
    }
  }
  active = chosen;
  await seedIfNeeded(store, chosen);
  return chosen;
}

async function seedIfNeeded(store: SqlStore, pack: RulesPack, force = false): Promise<void> {
  const seeded = await store.getSetting(KEY_SEEDED);
  const categories = await store.listCategories();
  if (!force && seeded === pack.version && categories.length > 0) return;
  await store.seedCategories(pack.categories);
  await store.seedMerchantRules(pack);
  await store.setSetting(KEY_SEEDED, pack.version);
}

/** Re-seeds after a wipe. */
export async function reseedRules(store: SqlStore): Promise<void> {
  await seedIfNeeded(store, activeRulesPack(), true);
}

export interface RulesUpdateResult {
  status: 'updated' | 'current' | 'skipped' | 'unavailable';
  version: string;
}

export async function refreshRulesPack(store: SqlStore, options: { force?: boolean } = {}): Promise<RulesUpdateResult> {
  const current = activeRulesPack();
  if (!appConfig.api.url) return { status: 'unavailable', version: current.version };
  const lastChecked = Number(await store.getSetting(KEY_CHECKED));
  if (!options.force && Number.isFinite(lastChecked) && Date.now() - lastChecked < CHECK_INTERVAL_MS) {
    return { status: 'skipped', version: current.version };
  }

  const etag = await store.getSetting(KEY_ETAG);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${appConfig.api.url}/api/v1/rules-pack`, {
      headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) },
    });
  } catch {
    return { status: 'unavailable', version: current.version };
  }

  await store.setSetting(KEY_CHECKED, String(Date.now()));
  if (response.status === 304) return { status: 'current', version: current.version };
  if (!response.ok) return { status: 'unavailable', version: current.version };

  try {
    const json: unknown = await response.json();
    const pack = parseRulesPack(json);
    if (compareRulesPackVersions(pack.version, current.version) <= 0) return { status: 'current', version: current.version };
    await store.setSetting(KEY_JSON, JSON.stringify(json));
    const newEtag = response.headers.get('etag');
    if (newEtag) await store.setSetting(KEY_ETAG, newEtag);
    active = pack;
    await seedIfNeeded(store, pack, true);
    log.info('rules pack updated', { version: pack.version });
    return { status: 'updated', version: pack.version };
  } catch (err) {
    log.warn('downloaded rules pack rejected', { err: err instanceof Error ? err.message : 'unknown' });
    return { status: 'unavailable', version: current.version };
  }
}
