/**
 * Rules pack — §1(A) of the architecture.
 *
 * Sender fingerprints, per-issuer templates and the merchant dictionary live in JSON so a
 * broken bank template is a data edit, not a code release. The JSON is bundled into the app
 * (`@expense/core/rules/rules-pack.json`) and a newer copy is fetched from the API daily;
 * the server reads the same file from disk. This module only validates and compiles it.
 */
import { ConfigError } from '../errors.js';
import type { TransactionKind } from './types.js';

export interface CategoryDef {
  key: string;
  name: string;
  colorHex: string;
  icon: string;
  sortOrder: number;
  excludedFromTotals: boolean;
}

export interface SenderTemplate {
  id: string;
  regex: RegExp;
  source: string;
  confidence: number;
  isCredit: boolean;
  dateFormat?: string;
  currency?: string;
  /** Financial source this template proves on its own, e.g. `hdfc_pixel_play`. */
  sourceKey?: string;
  /** Overrides the derived debit/credit/refund/transfer kind. */
  txnKind?: TransactionKind;
}

export interface SenderRule {
  id: string;
  issuer: string;
  kind: 'bank' | 'merchant' | 'processor';
  defaultCurrency: string;
  merchantName?: string;
  addresses: string[];
  domains: string[];
  templates: SenderTemplate[];
  /** Financial source assumed for this sender when nothing more specific matches. */
  defaultSourceKey?: string;
}

/** A bank account or card the app tracks separately (§ multiple financial sources). */
export type FinancialSourceKind = 'bank_account' | 'credit_card';

export interface FinancialSourceRule {
  key: string;
  label: string;
  shortLabel: string;
  kind: FinancialSourceKind;
  issuer: string;
  colorHex: string;
  icon: string;
  /** Checked highest first, so a card sharing its bank's sender address wins. */
  priority: number;
  senderAddresses: string[];
  senderDomains: string[];
  subjectPatterns: RegExp[];
  bodyPatterns: RegExp[];
  /** Any hit here disqualifies the source, e.g. a Pixel Play alert is not the bank account. */
  negativeBodyPatterns: RegExp[];
  /** Claim mail from this sender even when no pattern matched. */
  senderFallback: boolean;
}

export interface MerchantEntry {
  display: string;
  category: string;
}

export interface KeywordRule {
  tokens: string[];
  category: string;
}

export interface RulesPack {
  version: string;
  schemaVersion: number;
  categories: CategoryDef[];
  financialSources: FinancialSourceRule[];
  financialSourcesByKey: Map<string, FinancialSourceRule>;
  senders: SenderRule[];
  sendersByAddress: Map<string, SenderRule>;
  sendersByDomain: Map<string, SenderRule>;
  merchants: Record<string, MerchantEntry>;
  merchantEntries: Array<[string, MerchantEntry]>;
  merchantAliases: Record<string, string>;
  /**
   * Normalized merchant → financial source, for vendors that bill one card but whose own
   * invoice emails name no account. Only consulted when nothing in the email identified one.
   */
  merchantSourceHints: Record<string, string>;
  keywordRules: KeywordRule[];
  transferSignals: string[];
  normalization: {
    railPrefixes: string[];
    cityTokens: string[];
    countryTokens: string[];
    stopSuffixes: string[];
  };
  discoveryHints: { subjectTerms: string[]; bodyPhrases: string[] };
}

/** Bumped whenever extraction behaviour changes; stored on every transaction. */
export const PARSER_VERSION = '1.2.0';

/** The newest rules-pack schema this build understands. Newer packs are ignored, not guessed at. */
export const SUPPORTED_RULES_SCHEMA_VERSION = 2;

/** Used when no financial source could be identified — a merchant receipt, or an unknown bank. */
export const UNKNOWN_SOURCE_KEY = 'unknown';

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ConfigError(`Rules pack field "${field}" must be an array`);
  return value;
}

function compile(raw: Record<string, unknown>, senderId: string): SenderTemplate {
  const id = String(raw.id ?? `${senderId}-unnamed`);
  const pattern = raw.pattern;
  if (typeof pattern !== 'string' || pattern === '') {
    throw new ConfigError(`Template ${id} is missing a pattern`);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, typeof raw.flags === 'string' ? raw.flags : 'is');
  } catch (err) {
    throw new ConfigError(`Template ${id} has an invalid regex: ${String(err)}`);
  }
  const template: SenderTemplate = {
    id,
    regex,
    source: pattern,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.9,
    isCredit: raw.isCredit === true,
  };
  if (typeof raw.dateFormat === 'string') template.dateFormat = raw.dateFormat;
  if (typeof raw.currency === 'string') template.currency = raw.currency;
  if (typeof raw.sourceKey === 'string') template.sourceKey = raw.sourceKey;
  if (typeof raw.txnKind === 'string') template.txnKind = raw.txnKind as TransactionKind;
  return template;
}

function compileSourcePatterns(raw: Record<string, unknown>, key: string, field: string): RegExp[] {
  return requireArray(raw[field] ?? [], `${key}.${field}`).map((pattern) => {
    try {
      return new RegExp(String(pattern), 'i');
    } catch (err) {
      throw new ConfigError(`Financial source ${key} has an invalid ${field} pattern: ${String(err)}`);
    }
  });
}

/**
 * Financial sources — the accounts and cards whose spending is reported separately. Kept in the
 * rules pack (not in code) so a new card is a data edit, and deliberately independent of which
 * Gmail account the mail arrived in.
 */
export function parseFinancialSources(value: unknown): FinancialSourceRule[] {
  const sources = requireArray(value ?? [], 'financialSources').map((s) => {
    const raw = s as Record<string, unknown>;
    const key = String(raw.key ?? '').trim();
    if (key === '' || key === UNKNOWN_SOURCE_KEY) {
      throw new ConfigError(`Financial source has an invalid key "${key}"`);
    }
    const label = String(raw.label ?? key);
    const kind: FinancialSourceKind = raw.kind === 'credit_card' ? 'credit_card' : 'bank_account';
    return {
      key,
      label,
      shortLabel: String(raw.shortLabel ?? label),
      kind,
      issuer: String(raw.issuer ?? label),
      colorHex: String(raw.colorHex ?? '#7A7A7A'),
      icon: String(raw.icon ?? 'bank'),
      priority: Number(raw.priority ?? 10),
      senderAddresses: requireArray(raw.senderAddresses ?? [], `${key}.senderAddresses`).map((a) => String(a).toLowerCase()),
      senderDomains: requireArray(raw.senderDomains ?? [], `${key}.senderDomains`).map((d) => String(d).toLowerCase()),
      subjectPatterns: compileSourcePatterns(raw, key, 'subjectPatterns'),
      bodyPatterns: compileSourcePatterns(raw, key, 'bodyPatterns'),
      negativeBodyPatterns: compileSourcePatterns(raw, key, 'negativeBodyPatterns'),
      senderFallback: raw.senderFallback === true,
    };
  });
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.key)) throw new ConfigError(`Duplicate financial source "${source.key}"`);
    seen.add(source.key);
  }
  return sources.sort((a, b) => b.priority - a.priority);
}

/** Validates raw rules-pack JSON and compiles its templates. Throws ConfigError when invalid. */
export function parseRulesPack(json: unknown): RulesPack {
  if (typeof json !== 'object' || json === null) throw new ConfigError('Rules pack must be a JSON object');
  const raw = json as Record<string, unknown>;

  const schemaVersion = Number(raw.schemaVersion ?? 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion > SUPPORTED_RULES_SCHEMA_VERSION) {
    throw new ConfigError(`Rules pack schema ${String(raw.schemaVersion)} is newer than this build supports`);
  }

  const categories: CategoryDef[] = requireArray(raw.categories, 'categories').map((c) => {
    const cat = c as Record<string, unknown>;
    return {
      key: String(cat.key),
      name: String(cat.name),
      colorHex: String(cat.colorHex ?? '#7A7A7A'),
      icon: String(cat.icon ?? 'tag'),
      sortOrder: Number(cat.sortOrder ?? 0),
      excludedFromTotals: cat.excludedFromTotals === true,
    };
  });
  if (categories.length === 0) throw new ConfigError('Rules pack defines no categories');

  const senders: SenderRule[] = requireArray(raw.senders, 'senders').map((s) => {
    const sender = s as Record<string, unknown>;
    const id = String(sender.id);
    const rule: SenderRule = {
      id,
      issuer: String(sender.issuer ?? id),
      kind: (sender.kind as SenderRule['kind']) ?? 'merchant',
      defaultCurrency: String(sender.defaultCurrency ?? 'INR').toUpperCase(),
      addresses: requireArray(sender.addresses ?? [], `${id}.addresses`).map((a) => String(a).toLowerCase()),
      domains: requireArray(sender.domains ?? [], `${id}.domains`).map((d) => String(d).toLowerCase()),
      templates: requireArray(sender.templates ?? [], `${id}.templates`).map((t) =>
        compile(t as Record<string, unknown>, id),
      ),
    };
    if (typeof sender.merchantName === 'string') rule.merchantName = sender.merchantName;
    if (typeof sender.defaultSourceKey === 'string') rule.defaultSourceKey = sender.defaultSourceKey;
    return rule;
  });

  const financialSources = parseFinancialSources(raw.financialSources);

  const merchants: Record<string, MerchantEntry> = {};
  const merchantsRaw = (raw.merchants ?? {}) as Record<string, unknown>;
  const categoryKeys = new Set(categories.map((c) => c.key));
  for (const [key, value] of Object.entries(merchantsRaw)) {
    if (!Array.isArray(value) || value.length < 2) {
      throw new ConfigError(`Merchant "${key}" must be [displayName, categoryKey]`);
    }
    const [display, category] = value as [string, string];
    if (!categoryKeys.has(category)) {
      throw new ConfigError(`Merchant "${key}" references unknown category "${category}"`);
    }
    merchants[key.toLowerCase()] = { display, category };
  }

  const merchantAliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries((raw.merchantAliases ?? {}) as Record<string, string>)) {
    merchantAliases[alias.toLowerCase()] = String(target).toLowerCase();
  }

  const merchantSourceHints: Record<string, string> = {};
  const sourceKeys = new Set(financialSources.map((s) => s.key));
  for (const [merchant, sourceKey] of Object.entries((raw.merchantSourceHints ?? {}) as Record<string, string>)) {
    const key = String(sourceKey);
    if (!sourceKeys.has(key)) {
      throw new ConfigError(`merchantSourceHints["${merchant}"] references unknown financial source "${key}"`);
    }
    merchantSourceHints[merchant.toLowerCase()] = key;
  }

  const keywordRules: KeywordRule[] = requireArray(raw.keywordRules ?? [], 'keywordRules').map((k) => {
    const rule = k as Record<string, unknown>;
    return {
      tokens: requireArray(rule.tokens, 'keywordRules.tokens').map((t) => String(t).toLowerCase()),
      category: String(rule.category),
    };
  });

  const normalization = (raw.normalization ?? {}) as Record<string, unknown>;
  const discovery = (raw.discoveryHints ?? {}) as Record<string, unknown>;

  const pack: RulesPack = {
    version: String(raw.version ?? 'unknown'),
    schemaVersion,
    categories,
    financialSources,
    financialSourcesByKey: new Map(financialSources.map((source) => [source.key, source])),
    senders,
    sendersByAddress: new Map(),
    sendersByDomain: new Map(),
    merchants,
    merchantEntries: Object.entries(merchants).sort((a, b) => b[0].length - a[0].length),
    merchantAliases,
    merchantSourceHints,
    keywordRules,
    transferSignals: requireArray(raw.transferSignals ?? [], 'transferSignals').map((t) => String(t).toLowerCase()),
    normalization: {
      railPrefixes: (normalization.railPrefixes as string[]) ?? [],
      cityTokens: (normalization.cityTokens as string[]) ?? [],
      countryTokens: (normalization.countryTokens as string[]) ?? [],
      stopSuffixes: (normalization.stopSuffixes as string[]) ?? [],
    },
    discoveryHints: {
      subjectTerms: (discovery.subjectTerms as string[]) ?? [],
      bodyPhrases: (discovery.bodyPhrases as string[]) ?? [],
    },
  };

  for (const sender of senders) {
    for (const address of sender.addresses) pack.sendersByAddress.set(address, sender);
    for (const domain of sender.domains) {
      if (!pack.sendersByDomain.has(domain)) pack.sendersByDomain.set(domain, sender);
    }
  }

  return pack;
}

/**
 * Compares two rules-pack version strings (`2026.09.14-1`). Returns > 0 when `a` is newer.
 * Numeric runs compare numerically so `-10` sorts after `-9`.
 */
export function compareRulesPackVersions(a: string, b: string): number {
  const partsA = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const partsB = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The templates that may parse an email from this sender, once its financial source is known.
 * A template tied to another product is excluded outright, so Pixel Play wording can never be
 * read by a bank-account template (or the reverse).
 */
export function templatesForSource(sender: SenderRule, sourceKey: string): SenderTemplate[] {
  if (sourceKey === UNKNOWN_SOURCE_KEY) return sender.templates;
  return sender.templates.filter((template) => !template.sourceKey || template.sourceKey === sourceKey);
}

/** Finds the sender rule for a `From` address, preferring an exact address match. */
export function matchSender(pack: RulesPack, fromAddress: string): SenderRule | null {
  const address = fromAddress.toLowerCase().trim();
  const direct = pack.sendersByAddress.get(address);
  if (direct) return direct;
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1);
  const byDomain = pack.sendersByDomain.get(domain);
  if (byDomain) return byDomain;
  // Also try the registrable-ish parent domain (mail.uber.com → uber.com).
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join('.');
    const hit = pack.sendersByDomain.get(parent);
    if (hit) return hit;
  }
  return null;
}
