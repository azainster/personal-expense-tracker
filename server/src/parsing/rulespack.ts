/**
 * Server-side rules-pack loading — §1(A).
 *
 * The pack itself (format, validation, sender matching) lives in @expense/core. The server
 * reads the JSON from disk, hot-reloads it, and serves it to the app at /api/v1/rules-pack so
 * a broken bank template is fixed by a data deploy instead of an App Store review.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ConfigError, parseRulesPack, type RulesPack } from '@expense/core';
import { createLogger } from '../logger.js';

export { matchSender, PARSER_VERSION, parseRulesPack } from '@expense/core';
export type { CategoryDef, MerchantEntry, RulesPack, SenderRule, SenderTemplate } from '@expense/core';

const log = createLogger('rulespack');

export function rulesPackPath(): string {
  return process.env.RULES_PACK_PATH
    ? resolve(process.env.RULES_PACK_PATH)
    : createRequire(import.meta.url).resolve('@expense/core/rules/rules-pack.json');
}

interface LoadedPack {
  pack: RulesPack;
  /** The JSON exactly as served to clients. */
  raw: unknown;
  etag: string;
}

let cached: LoadedPack | null = null;

function load(force: boolean): LoadedPack {
  if (cached && !force) return cached;
  const path = rulesPackPath();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Could not read rules pack at ${path}`, { cause: String(err) });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`Rules pack at ${path} is not valid JSON: ${String(err)}`);
  }
  const pack = parseRulesPack(json);
  cached = { pack, raw: json, etag: `"${createHash('sha256').update(text).digest('hex').slice(0, 32)}"` };
  log.info('rules pack loaded', {
    version: pack.version,
    senders: pack.senders.length,
    merchants: Object.keys(pack.merchants).length,
    categories: pack.categories.length,
  });
  return cached;
}

export function loadRulesPack(force = false): RulesPack {
  return load(force).pack;
}

/** Raw JSON + ETag for the public rules-pack endpoint. */
export function rulesPackForClients(): { raw: unknown; etag: string; version: string } {
  const loaded = load(false);
  return { raw: loaded.raw, etag: loaded.etag, version: loaded.pack.version };
}
