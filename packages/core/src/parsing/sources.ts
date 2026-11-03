/**
 * Financial sources — which account or card a transaction belongs to.
 *
 * The app tracks several accounts inside one Gmail inbox: an HDFC Bank account, an HDFC Pixel
 * Play credit card and a Union Bank of India account all send mail from bank domains, and two
 * of them from the *same* domain. So the source is identified from the evidence in the email
 * rather than from the mailbox it arrived in:
 *
 *   1. a matched sender template that only one product uses (strongest);
 *   2. subject/body patterns, highest-priority source first (Pixel Play before HDFC Bank);
 *   3. the sender's declared default, for mail from a bank whose wording we didn't recognise.
 *
 * This deliberately knows nothing about Gmail authentication: connecting a second Gmail account
 * later changes nothing here.
 */
import { UNKNOWN_SOURCE_KEY, type FinancialSourceRule, type RulesPack } from './rulespack.js';

export { UNKNOWN_SOURCE_KEY };

export interface FinancialSourceIdentification {
  sourceKey: string;
  label: string;
  shortLabel: string;
  /** 0–1. Below ~0.6 the transaction is worth a human glance. */
  confidence: number;
  /** Content-free explanation for the debug screen, e.g. `body pattern`. */
  reason: string;
}

export const UNKNOWN_SOURCE: FinancialSourceIdentification = {
  sourceKey: UNKNOWN_SOURCE_KEY,
  label: 'Other account',
  shortLabel: 'Other',
  confidence: 0,
  reason: 'no source matched',
};

function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : '';
}

/** True when the rule names this sender, or names no sender at all (content-only rule). */
function senderMatches(rule: FinancialSourceRule, address: string, domain: string): boolean {
  if (rule.senderAddresses.length === 0 && rule.senderDomains.length === 0) return true;
  if (rule.senderAddresses.includes(address)) return true;
  return rule.senderDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function identified(rule: FinancialSourceRule, confidence: number, reason: string): FinancialSourceIdentification {
  return { sourceKey: rule.key, label: rule.label, shortLabel: rule.shortLabel, confidence, reason };
}

export interface IdentifySourceInput {
  pack: RulesPack;
  senderAddress: string;
  /** Raw From header, e.g. `HDFC Bank InstaAlerts <alerts@hdfcbank.net>` — the display name is evidence. */
  fromHeader?: string | undefined;
  subject: string;
  /** Cleaned body text. */
  text: string;
  /** Source declared by the sender template that matched, when any. */
  templateSourceKey?: string | undefined;
  /** `defaultSourceKey` of the matched sender rule, when any. */
  senderDefaultSourceKey?: string | undefined;
  /**
   * Normalized merchant, used only to look up `merchantSourceHints` — how a vendor's own
   * invoice (which names no account) is attributed to the card that pays it.
   */
  merchantNormalized?: string | undefined;
}

export function identifyFinancialSource(input: IdentifySourceInput): FinancialSourceIdentification {
  const { pack, subject, text } = input;
  const address = input.senderAddress.toLowerCase().trim();
  const domain = domainOf(address);

  // 1 — the template that read the amount already knows the product.
  if (input.templateSourceKey) {
    const rule = pack.financialSourcesByKey.get(input.templateSourceKey);
    if (rule) return identified(rule, 0.99, 'sender template');
  }

  // 2 — patterns, highest priority first (financialSources is pre-sorted).
  const haystack = `${input.fromHeader ?? ''}\n${subject}\n${text}`;
  const senderCandidates = pack.financialSources.filter((rule) => senderMatches(rule, address, domain));
  for (const rule of senderCandidates) {
    if (rule.negativeBodyPatterns.some((re) => re.test(haystack))) continue;
    if (rule.subjectPatterns.some((re) => re.test(subject))) return identified(rule, 0.95, 'subject pattern');
    if (rule.bodyPatterns.some((re) => re.test(haystack))) return identified(rule, 0.92, 'body pattern');
  }

  // 3 — the sender's own default, so an unrecognised alert from a known bank is still filed.
  if (input.senderDefaultSourceKey) {
    const rule = pack.financialSourcesByKey.get(input.senderDefaultSourceKey);
    if (rule && !rule.negativeBodyPatterns.some((re) => re.test(haystack))) {
      return identified(rule, 0.7, 'sender default');
    }
  }
  for (const rule of senderCandidates) {
    if (!rule.senderFallback) continue;
    if (rule.negativeBodyPatterns.some((re) => re.test(haystack))) continue;
    return identified(rule, 0.65, 'sender fallback');
  }

  // 4 — a vendor that always bills one card. Last, so real evidence always wins.
  const hinted = sourceFromMerchantHint(pack, input.merchantNormalized);
  if (hinted) return hinted;

  return UNKNOWN_SOURCE;
}

/**
 * The account a vendor's own invoice is billed to (`merchantSourceHints`). Only for emails
 * where nothing identified an account — a bank alert always outranks this.
 */
export function sourceFromMerchantHint(pack: RulesPack, merchantNormalized: string | null | undefined): FinancialSourceIdentification | null {
  if (!merchantNormalized) return null;
  const hinted = pack.merchantSourceHints[merchantNormalized.toLowerCase()];
  const rule = hinted ? pack.financialSourcesByKey.get(hinted) : undefined;
  return rule ? identified(rule, 0.6, 'merchant billed to this account') : null;
}

/** Display details for a stored `sourceKey`, including the unknown bucket. */
export function financialSourceInfo(
  pack: RulesPack,
  sourceKey: string | null | undefined,
): { key: string; label: string; shortLabel: string; colorHex: string; icon: string; kind: string } {
  const rule = sourceKey ? pack.financialSourcesByKey.get(sourceKey) : undefined;
  if (!rule) {
    return { key: UNKNOWN_SOURCE_KEY, label: UNKNOWN_SOURCE.label, shortLabel: UNKNOWN_SOURCE.shortLabel, colorHex: '#7A7A7A', icon: 'wallet', kind: 'other' };
  }
  return { key: rule.key, label: rule.label, shortLabel: rule.shortLabel, colorHex: rule.colorHex, icon: rule.icon, kind: rule.kind };
}

/** The tracked sources in display order (highest priority first), for filters and dashboards. */
export function listFinancialSources(pack: RulesPack): FinancialSourceRule[] {
  return [...pack.financialSources];
}
