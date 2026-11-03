/**
 * Categorization cascade — §4 of the architecture. Cheapest first, cached aggressively:
 * each distinct merchant is classified once, ever, not once per transaction.
 *
 *  1. user override table (always wins, permanently)
 *  2. merchant dictionary (bundled + rules pack)
 *  3. MCC code, when the email carries one
 *  4. keyword rules on merchant tokens
 *  5. nearest-neighbour similarity against labelled dictionary entries
 *  6. LLM classification (see llm.ts) — one call per new merchant string
 */
import type { RulesPack } from './rulespack.js';

export type CategorySource = 'user' | 'dictionary' | 'mcc' | 'keyword' | 'similarity' | 'llm' | 'fallback';

export interface CategoryResolution {
  categoryKey: string;
  source: CategorySource;
  confidence: number;
  /** True when the caller should persist this into merchant_rules as a learned mapping. */
  cacheable: boolean;
}

export interface MerchantRuleRecord {
  normalizedName: string;
  displayName: string;
  categoryKey: string;
  source: string;
  isUserOverride: boolean;
}

/** ISO 18245 merchant category codes that appear in Indian and US bank alerts. */
const MCC_TO_CATEGORY: Array<[RegExp, string]> = [
  [/^5411$/, 'groceries'],
  [/^(5412|5422|5441|5451|5462|5499)$/, 'groceries'],
  [/^(5812|5814)$/, 'food_dining'],
  [/^5813$/, 'entertainment'],
  [/^(4111|4121|4131|4784|7523)$/, 'transport'],
  [/^(5541|5542|5552)$/, 'transport'],
  [/^(3000|3001|3999|4511|4582)$/, 'travel'],
  [/^(3500|3999|7011)$/, 'travel'],
  [/^(5912|8011|8021|8042|8062|8071|8099)$/, 'health'],
  [/^(4812|4814|4816|4899|4900)$/, 'bills'],
  [/^(5691|5651|5661|5311|5310|5399|5732|5734|5942|5944|5945|5999)$/, 'shopping'],
  [/^(7832|7841|7929|7994|7996)$/, 'entertainment'],
  [/^(4829|6012|6051|6540)$/, 'transfers'],
];

function trigrams(input: string): Set<string> {
  const padded = `  ${input} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Step 5: nearest neighbour against the labelled dictionary. This is the portable stand-in
 * for `NLEmbedding.sentenceEmbedding` in the iOS design — same role, no model weights.
 */
export function nearestCategoryBySimilarity(
  normalizedMerchant: string,
  pack: RulesPack,
  threshold = 0.55,
): { categoryKey: string; score: number } | null {
  const target = trigrams(normalizedMerchant);
  let best: { categoryKey: string; score: number } | null = null;
  for (const [key, entry] of pack.merchantEntries) {
    const score = diceCoefficient(target, trigrams(key));
    if (!best || score > best.score) best = { categoryKey: entry.category, score };
  }
  if (best && best.score >= threshold) return best;
  return null;
}

export function detectTransfer(text: string, pack: RulesPack): boolean {
  const lower = text.toLowerCase();
  return pack.transferSignals.some((signal) => lower.includes(signal));
}

export interface CategorizeInput {
  normalizedMerchant: string;
  displayMerchant: string;
  mcc?: string;
  bodyText?: string;
  isCredit?: boolean;
  pack: RulesPack;
  lookup: (normalizedName: string) => MerchantRuleRecord | null;
}

export function categorize(input: CategorizeInput): CategoryResolution {
  const { normalizedMerchant, displayMerchant, mcc, bodyText, isCredit, pack, lookup } = input;

  // 1 — user override, permanently authoritative.
  const stored = lookup(normalizedMerchant);
  if (stored?.isUserOverride) {
    return { categoryKey: stored.categoryKey, source: 'user', confidence: 1, cacheable: false };
  }

  // Transfers and income are detected from the email language, not the merchant.
  if (bodyText && detectTransfer(bodyText, pack)) {
    return { categoryKey: 'transfers', source: 'keyword', confidence: 0.85, cacheable: false };
  }
  if (isCredit && bodyText && /\b(salary|payroll|interest credited|dividend)\b/i.test(bodyText)) {
    return { categoryKey: 'income', source: 'keyword', confidence: 0.85, cacheable: false };
  }

  // 2 — dictionary (rules pack, plus anything previously learned and stored).
  const packEntry = pack.merchants[normalizedMerchant];
  if (packEntry) {
    return { categoryKey: packEntry.category, source: 'dictionary', confidence: 0.95, cacheable: true };
  }
  if (stored) {
    return {
      categoryKey: stored.categoryKey,
      source: stored.source === 'llm' ? 'llm' : 'dictionary',
      confidence: 0.9,
      cacheable: false,
    };
  }

  // 3 — MCC, authoritative when present.
  if (mcc) {
    for (const [pattern, category] of MCC_TO_CATEGORY) {
      if (pattern.test(mcc)) return { categoryKey: category, source: 'mcc', confidence: 0.9, cacheable: true };
    }
  }

  // 4 — keyword rules on merchant tokens.
  const haystack = `${normalizedMerchant} ${displayMerchant}`.toLowerCase();
  for (const rule of pack.keywordRules) {
    if (rule.tokens.some((token) => haystack.includes(token))) {
      return { categoryKey: rule.category, source: 'keyword', confidence: 0.75, cacheable: true };
    }
  }

  // 5 — similarity against labelled entries.
  const similar = nearestCategoryBySimilarity(normalizedMerchant, pack);
  if (similar) {
    return {
      categoryKey: similar.categoryKey,
      source: 'similarity',
      confidence: Number((0.5 + similar.score * 0.3).toFixed(2)),
      cacheable: false,
    };
  }

  if (isCredit) return { categoryKey: 'income', source: 'fallback', confidence: 0.4, cacheable: false };
  return { categoryKey: 'other', source: 'fallback', confidence: 0.3, cacheable: false };
}
