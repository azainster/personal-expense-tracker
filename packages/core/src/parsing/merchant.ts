/**
 * Merchant normalization — §3 of the architecture.
 *
 *   "POS 4023XXXX5512 AMAZON RETAIL*MK1 BANGALORE IN" → "amazon"
 *   "UPI/P2M/412345678/SWIGGY"                        → "swiggy"
 *
 * Pipeline: uppercase → strip card fragments / terminal IDs / long digit runs →
 * strip city and country tokens → strip payment-rail prefixes → collapse whitespace →
 * fuzzy match against the dictionary.
 */
import type { RulesPack } from './rulespack.js';
import { jaroWinkler } from './similarity.js';

export interface NormalizedMerchant {
  /** Dictionary key when matched, otherwise the cleaned token string. */
  normalized: string;
  /** Human-facing label. */
  display: string;
  /** Exactly as it appeared in the email. */
  raw: string;
  matchedDictionary: boolean;
  matchKind: 'alias' | 'exact' | 'contains' | 'fuzzy' | 'none';
  similarity: number;
}

const MASKED_CARD_RE = /\b(?:[xX*]{2,}\d{2,6}|\d{2,6}[xX*]{2,}\d{0,6}|[xX]{4,})\b/g;
const LONG_DIGITS_RE = /\b\d{4,}\b/g;
const TERMINAL_ID_RE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{2,6}$/;
const ORDER_REF_RE = /\b(?:ref|txn|order|inv|id|no)[:#]?\s*[A-Z0-9-]{4,}\b/gi;

/** Splits a VPA / email-shaped descriptor down to its local part. */
function stripHandle(input: string): string {
  const at = input.indexOf('@');
  if (at <= 0) return input;
  const local = input.slice(0, at);
  return /^\d+$/.test(local) ? '' : local;
}

export function cleanMerchantTokens(raw: string, pack: RulesPack, stripSuffixes = true): string {
  let text = ` ${raw} `;

  text = text.replace(ORDER_REF_RE, ' ');
  text = text.replace(/[\\/*_|•·,;:()\[\]{}"“”'’]+/g, ' ');
  text = text.replace(/(?<=\S)-(?=\S)/g, ' ');
  text = text.replace(/\s+-\s+/g, ' ');
  text = text.replace(/\.(?=\s|$)/g, ' ');

  text = text
    .split(/\s+/)
    .map((token) => stripHandle(token))
    .join(' ');

  text = text.toUpperCase();
  text = text.replace(MASKED_CARD_RE, ' ');
  text = text.replace(LONG_DIGITS_RE, ' ');

  let tokens = text.split(/\s+/).filter((t) => t !== '');

  const rails = new Set(pack.normalization.railPrefixes.map((t) => t.toUpperCase()));
  const cities = new Set(pack.normalization.cityTokens.map((t) => t.toUpperCase()));
  const countries = new Set(pack.normalization.countryTokens.map((t) => t.toUpperCase()));
  const suffixes = new Set(pack.normalization.stopSuffixes.map((t) => t.toUpperCase()));

  // Multi-word city names ("NEW DELHI", "SAN FRANCISCO") need a windowed pass.
  const multiWordCities = pack.normalization.cityTokens
    .map((c) => c.toUpperCase())
    .filter((c) => c.includes(' '));
  for (const city of multiWordCities) {
    const parts = city.split(' ');
    for (let i = 0; i <= tokens.length - parts.length; i += 1) {
      if (parts.every((p, k) => tokens[i + k] === p)) {
        tokens.splice(i, parts.length);
        i -= 1;
      }
    }
  }

  const meaningful = tokens.filter(
    (t) =>
      !rails.has(t) &&
      !cities.has(t) &&
      !countries.has(t) &&
      !(stripSuffixes && suffixes.has(t)) &&
      !TERMINAL_ID_RE.test(t),
  );
  // Never strip everything: if the descriptor was nothing but noise words, keep the noise.
  if (meaningful.length > 0) tokens = meaningful;
  else {
    const withoutRails = tokens.filter((t) => !rails.has(t));
    if (withoutRails.length > 0) tokens = withoutRails;
  }

  const cleaned = tokens
    .join(' ')
    .replace(/[^A-Z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return cleaned;
}

function titleCase(input: string): string {
  return input
    .split(' ')
    .filter(Boolean)
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(' ');
}

export function normalizeMerchant(raw: string, pack: RulesPack): NormalizedMerchant {
  const cleaned = cleanMerchantTokens(raw ?? '', pack);
  // Suffix stripping is aggressive by design, but it can destroy a legal-entity alias
  // ("BUNDL TECHNOLOGIES" → "bundl"), so the un-stripped form gets first refusal.
  const withSuffixes = cleanMerchantTokens(raw ?? '', pack, false);
  if (withSuffixes !== cleaned && withSuffixes !== '') {
    const aliasTarget = pack.merchantAliases[withSuffixes];
    const entry = aliasTarget ? pack.merchants[aliasTarget] : pack.merchants[withSuffixes];
    if (entry) {
      const key = aliasTarget ?? withSuffixes;
      return {
        normalized: key,
        display: entry.display,
        raw,
        matchedDictionary: true,
        matchKind: aliasTarget ? 'alias' : 'exact',
        similarity: 1,
      };
    }
  }
  const base: NormalizedMerchant = {
    normalized: cleaned,
    display: cleaned === '' ? 'Unknown merchant' : titleCase(cleaned),
    raw,
    matchedDictionary: false,
    matchKind: 'none',
    similarity: 0,
  };
  if (cleaned === '') return base;

  const alias = pack.merchantAliases[cleaned];
  if (alias) {
    const entry = pack.merchants[alias];
    return {
      ...base,
      normalized: alias,
      display: entry?.display ?? titleCase(alias),
      matchedDictionary: Boolean(entry),
      matchKind: 'alias',
      similarity: 1,
    };
  }

  const exact = pack.merchants[cleaned];
  if (exact) {
    return { ...base, normalized: cleaned, display: exact.display, matchedDictionary: true, matchKind: 'exact', similarity: 1 };
  }

  // Word-boundary containment — "amazon retail bengaluru" style leftovers.
  const tokens = cleaned.split(' ');
  for (const [key, entry] of pack.merchantEntries) {
    const keyTokens = key.split(' ');
    if (keyTokens.length > tokens.length) continue;
    for (let i = 0; i <= tokens.length - keyTokens.length; i += 1) {
      if (keyTokens.every((k, j) => tokens[i + j] === k)) {
        return { ...base, normalized: key, display: entry.display, matchedDictionary: true, matchKind: 'contains', similarity: 0.95 };
      }
    }
  }
  for (const [aliasKey, target] of Object.entries(pack.merchantAliases)) {
    const keyTokens = aliasKey.split(' ');
    if (keyTokens.length > tokens.length) continue;
    for (let i = 0; i <= tokens.length - keyTokens.length; i += 1) {
      if (keyTokens.every((k, j) => tokens[i + j] === k)) {
        const entry = pack.merchants[target];
        return {
          ...base,
          normalized: target,
          display: entry?.display ?? titleCase(target),
          matchedDictionary: Boolean(entry),
          matchKind: 'contains',
          similarity: 0.93,
        };
      }
    }
  }

  // Single-token descriptors that swallow a known brand: "tatastarbucks" → "starbucks".
  if (tokens.length === 1 && cleaned.length >= 6) {
    for (const [key, entry] of pack.merchantEntries) {
      if (key.length >= 5 && !key.includes(' ') && cleaned.includes(key)) {
        return { ...base, normalized: key, display: entry.display, matchedDictionary: true, matchKind: 'contains', similarity: 0.92 };
      }
    }
    for (const [aliasKey, target] of Object.entries(pack.merchantAliases)) {
      if (aliasKey.length >= 5 && !aliasKey.includes(' ') && cleaned.includes(aliasKey)) {
        const entry = pack.merchants[target];
        return {
          ...base,
          normalized: target,
          display: entry?.display ?? titleCase(target),
          matchedDictionary: Boolean(entry),
          matchKind: 'contains',
          similarity: 0.9,
        };
      }
    }
  }

  // Fuzzy, last resort. 0.9 keeps "swiggy" from absorbing "swiggy instamart".
  let best: { key: string; score: number } | null = null;
  for (const [key] of pack.merchantEntries) {
    const score = jaroWinkler(cleaned, key);
    if (!best || score > best.score) best = { key, score };
  }
  if (best && best.score >= 0.9) {
    const entry = pack.merchants[best.key];
    return {
      ...base,
      normalized: best.key,
      display: entry?.display ?? titleCase(best.key),
      matchedDictionary: true,
      matchKind: 'fuzzy',
      similarity: Number(best.score.toFixed(3)),
    };
  }

  return base;
}

/**
 * Best-effort merchant for a sender address when nothing better is available.
 * Tries each brand candidate and keeps the first that lands in the dictionary.
 */
export function inferMerchantFromSender(address: string, pack: RulesPack, brandCandidates: string[]): NormalizedMerchant | null {
  let first: NormalizedMerchant | null = null;
  for (const candidate of brandCandidates) {
    const normalized = normalizeMerchant(candidate, pack);
    if (normalized.matchedDictionary) return normalized;
    if (!first && normalized.normalized !== '') first = normalized;
  }
  return first;
}
