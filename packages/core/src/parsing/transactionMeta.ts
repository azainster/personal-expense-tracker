/**
 * Debit vs credit vs refund vs transfer, and the bank reference number.
 *
 * Only a `debit` is expenditure. A `refund` is money coming back from a merchant, so it is
 * stored as a credit and subtracts from the category it was charged to (§6) instead of being
 * reported as income. A `transfer` between the person's own accounts is not spending at all.
 */
import type { TransactionKind } from './types.js';

const REFUND_MARKERS = [
  /\brefund(?:ed|s)?\b/i,
  /\breversal\b/i,
  /\brevers(?:ed|ing)\b/i,
  /\bchargeback\b/i,
  /\breturned to your\b/i,
  /\bcredited back\b/i,
  /\bmoney back\b/i,
  /\bcancell?ed order\b/i,
];

const INCOME_MARKERS = [/\bsalary\b/i, /\bpayroll\b/i, /\binterest credited\b/i, /\bdividend\b/i, /\bcashback\b/i];

export interface DeriveKindInput {
  isCredit: boolean;
  isTransfer: boolean;
  /** Subject + body; only matched against, never stored. */
  text: string;
  /** A template may state the kind outright (a Pixel Play refund alert, say). */
  templateKind?: TransactionKind | undefined;
}

export function deriveTransactionKind(input: DeriveKindInput): TransactionKind {
  if (input.isTransfer) return 'transfer';
  if (input.templateKind === 'refund') return 'refund';
  if (input.templateKind && input.templateKind !== 'debit' && input.templateKind !== 'credit') return input.templateKind;
  if (!input.isCredit) return 'debit';
  if (INCOME_MARKERS.some((re) => re.test(input.text))) return 'credit';
  if (REFUND_MARKERS.some((re) => re.test(input.text))) return 'refund';
  return 'credit';
}

/**
 * Bank reference for a transaction: UPI reference, UTR, RRN or transaction id.
 *
 * Anchored to a label, because an unanchored long number picks up available balances and phone
 * numbers. Banks pad the label freely — "UPI Ref no 419…", "UTR: 328…", "Your UPI transaction
 * reference number is 412…" — so filler words between label and value are allowed, and the
 * first candidate that actually looks like a reference (a run of digits) wins.
 */
const REFERENCE_RE =
  /\b(?:upi(?:\s+transaction)?|transaction|txn|utr|rrn|ref(?:erence)?)(?:[\s.:#-]*(?:ref(?:erence)?|no|number|id|is)\b)*[\s.:#-]*([A-Za-z0-9]{6,25})\b/gi;

export function extractReferenceId(text: string): string | null {
  for (const match of text.matchAll(REFERENCE_RE)) {
    const value = match[1];
    // A reference always carries a digit run; a trailing word ("of", "number") never does.
    if (value && /\d{4,}/.test(value)) return value.toUpperCase();
  }
  return null;
}

/** `8:45`, `08:45:12`, `20:05 hrs` → `08:45`. Returns null for anything that isn't a clock time. */
export function normalizeClockTime(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Time printed next to the transaction date in bank alerts, e.g. "on 12-09-2026 at 08:45:12". */
const TIME_NEAR_DATE = /\b(?:at|,)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:hrs?|hours)?\b/i;

export function extractClockTime(text: string): string | null {
  const match = TIME_NEAR_DATE.exec(text);
  return normalizeClockTime(match?.[1]);
}
