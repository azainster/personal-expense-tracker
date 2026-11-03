/**
 * Deduplication — §3. "One coffee purchase can produce three emails: the bank debit alert,
 * the merchant's receipt, and the payment app's confirmation. Naive summing triples the
 * user's reported spend."
 *
 *   dedupeKey = hash(amountMinor, currency, floor(date to day), normalizedMerchant)
 *
 * followed by a fuzzy pass: same amount + currency, dates within ±3 days, and either
 * merchant similarity > 0.85 or a matching card last-4.
 */
import { sha256Hex } from '../sha256.js';
import { UNKNOWN_SOURCE_KEY } from './rulespack.js';
import { jaroWinkler } from './similarity.js';

export const FUZZY_DAY_WINDOW = 3;
export const MERCHANT_SIMILARITY_THRESHOLD = 0.85;

export interface DedupeSubject {
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
  merchantNormalized: string;
  accountLast4?: string | null;
  isCredit: boolean;
  /**
   * Financial account/card. Two identical amounts on the same day are *not* the same
   * transaction when one is the HDFC Bank account and the other the Pixel Play card.
   */
  sourceKey?: string | null;
  /** 'bank' | 'merchant' | 'processor' — drives the merge rule. */
  senderKind?: string;
}

export function dayFloorIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeDedupeKey(subject: DedupeSubject): string {
  const parts = [
    String(subject.amountMinor),
    subject.currencyCode.toUpperCase(),
    dayFloorIso(subject.occurredAt),
    subject.merchantNormalized,
    subject.isCredit ? 'C' : 'D',
    subject.sourceKey && subject.sourceKey !== UNKNOWN_SOURCE_KEY ? subject.sourceKey : '',
  ].join('|');
  return sha256Hex(parts).slice(0, 32);
}

/**
 * True when both records name a financial source and the sources differ. Such a pair is never
 * one transaction, however alike the amount, date and merchant are.
 */
function differentKnownSources(a: DedupeSubject, b: DedupeSubject): boolean {
  const left = a.sourceKey ?? UNKNOWN_SOURCE_KEY;
  const right = b.sourceKey ?? UNKNOWN_SOURCE_KEY;
  if (left === UNKNOWN_SOURCE_KEY || right === UNKNOWN_SOURCE_KEY) return false;
  return left !== right;
}

export interface DuplicateMatch<T extends DedupeSubject> {
  existing: T;
  similarity: number;
  kind: 'exact-key' | 'fuzzy-merchant' | 'fuzzy-last4';
}

function daysApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/** Returns the existing record that `candidate` duplicates, or null. */
export function findDuplicate<T extends DedupeSubject & { dedupeKey?: string }>(
  candidate: DedupeSubject,
  existing: T[],
): DuplicateMatch<T> | null {
  const key = computeDedupeKey(candidate);

  for (const row of existing) {
    if (differentKnownSources(candidate, row)) continue;
    if (row.dedupeKey && row.dedupeKey === key) {
      return { existing: row, similarity: 1, kind: 'exact-key' };
    }
  }

  let best: DuplicateMatch<T> | null = null;
  for (const row of existing) {
    if (differentKnownSources(candidate, row)) continue;
    if (row.amountMinor !== candidate.amountMinor) continue;
    if (row.currencyCode.toUpperCase() !== candidate.currencyCode.toUpperCase()) continue;
    if (row.isCredit !== candidate.isCredit) continue;
    if (daysApart(row.occurredAt, candidate.occurredAt) > FUZZY_DAY_WINDOW) continue;

    const last4Match =
      Boolean(candidate.accountLast4) && Boolean(row.accountLast4) && candidate.accountLast4 === row.accountLast4;
    const similarity = jaroWinkler(candidate.merchantNormalized, row.merchantNormalized);

    if (similarity >= MERCHANT_SIMILARITY_THRESHOLD) {
      if (!best || similarity > best.similarity) {
        best = { existing: row, similarity: Number(similarity.toFixed(3)), kind: 'fuzzy-merchant' };
      }
    } else if (last4Match) {
      // Same card, same amount, same few days: the merchant strings differ because one
      // source is a bank descriptor and the other a merchant receipt.
      if (!best || best.similarity < 0.9) {
        best = { existing: row, similarity: Number(Math.max(similarity, 0.9).toFixed(3)), kind: 'fuzzy-last4' };
      }
    }
  }

  return best;
}

export interface MergeableRecord {
  merchantRaw: string;
  merchantNormalized: string;
  merchantDisplay: string;
  accountLast4?: string | null;
  accountLabel?: string | null;
  occurredAt: Date;
  confidence: number;
  senderKind?: string;
  extractionMethod: string;
}

/**
 * Merge rule from §3: merchant name from the merchant receipt (cleaner), account/card from
 * the bank alert (authoritative), earliest date. Returns the fields to write onto the
 * surviving primary record.
 */
export function mergeDuplicate(primary: MergeableRecord, incoming: MergeableRecord): Partial<MergeableRecord> {
  const updates: Record<string, unknown> = {};

  const incomingIsMerchantReceipt = incoming.senderKind === 'merchant';
  const primaryIsMerchantReceipt = primary.senderKind === 'merchant';

  if (incomingIsMerchantReceipt && !primaryIsMerchantReceipt) {
    updates.merchantRaw = incoming.merchantRaw;
    updates.merchantNormalized = incoming.merchantNormalized;
    updates.merchantDisplay = incoming.merchantDisplay;
  }

  const incomingIsBank = incoming.senderKind === 'bank';
  if (incomingIsBank && !primary.accountLast4 && incoming.accountLast4) {
    updates.accountLast4 = incoming.accountLast4;
    if (incoming.accountLabel) updates.accountLabel = incoming.accountLabel;
  }

  if (incoming.occurredAt.getTime() < primary.occurredAt.getTime()) {
    updates.occurredAt = incoming.occurredAt;
  }

  if (incoming.confidence > primary.confidence) {
    updates.confidence = incoming.confidence;
    updates.extractionMethod = incoming.extractionMethod;
  }

  return updates as Partial<MergeableRecord>;
}
