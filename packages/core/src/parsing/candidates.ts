/**
 * L2 — scored candidate extraction (§3 of the architecture).
 *
 * "The naive approach — first currency-looking thing in the email — fails constantly,
 * because a bank alert contains the debit amount, the available balance, the credit limit,
 * and sometimes reward points. Correct approach: extract every money-like span, score each,
 * take the argmax."
 */
import type { ExtractedDocument } from './html.js';
import { BARE_DECIMAL_RE, MONEY_SPAN_RE, currencyFromToken, parseAmountString } from './money.js';

/** Positive signals within ±60 characters. */
export const POSITIVE_SIGNALS: Array<[string, number]> = [
  ['debited', 3.0], ['charged', 3.0], ['you paid', 3.0], ['amount paid', 3.0],
  ['order total', 3.0], ['grand total', 3.0], ['total paid', 3.0], ['bill total', 3.0],
  ['spent', 3.0], ['was spent', 3.0], ['payment of', 2.5], ['debit', 2.5],
  ['total', 2.5], ['amount payable', 2.5], ['net payable', 2.5], ['amount', 2.0],
  ['txn', 2.0], ['transaction', 2.0], ['purchase', 2.0], ['paid', 2.0],
  ['withdrawn', 2.0], ['credited', 2.0], ['received', 1.5], ['fare', 2.0],
  // Non-English receipts are common in a mailbox; these keep them above the floor.
  ['gesamtbetrag', 3.0], ['bezahlt', 2.5], ['betrag', 2.0], ['montant', 2.5],
  ['importe total', 2.5], ['totale', 2.5], ['importo', 2.5],
];

/** Negative signals — these are the ones that cause silent wrong answers. */
export const NEGATIVE_SIGNALS: Array<[string, number]> = [
  ['available balance', -5.0], ['avl bal', -5.0], ['avbl bal', -5.0], ['wallet balance', -5.0],
  ['credit limit', -5.0], ['available credit', -5.0], ['minimum amount due', -4.5],
  ['minimum due', -4.5], ['previous balance', -4.0], ['outstanding', -4.0],
  ['you saved', -4.0], ['you save', -4.0], ['reward', -4.0], ['points', -4.0],
  ['cashback', -3.0], ['savings', -3.0], ['mrp', -3.0], ['discount', -3.0],
  ['coupon', -3.0], ['balance', -3.0], ['limit', -3.0], ['subtotal', -2.0],
  ['item total', -2.0], ['tax', -2.0], ['gst', -2.0], ['cgst', -2.0], ['sgst', -2.0],
  ['shipping', -2.0], ['delivery fee', -2.0], ['packaging', -2.0], ['convenience fee', -2.0],
  ['tip', -1.5], ['offer', -2.0], ['emi of', -1.5], ['per month', -1.5], ['starting at', -3.0],
];

const CREDIT_SIGNALS = ['credited', 'refund', 'refunded', 'reversal', 'reversed', 'cashback received', 'received from'];

export const SCORING_WINDOW = 60;

/** Both tables, longest phrase first, so specific phrases win over the words inside them. */
const ALL_SIGNALS: Array<[string, number]> = [...POSITIVE_SIGNALS, ...NEGATIVE_SIGNALS].sort(
  (a, b) => b[0].length - a[0].length,
);

export interface ScoreReason {
  label: string;
  delta: number;
}

export interface AmountCandidate {
  minorUnits: number;
  currency: string;
  raw: string;
  start: number;
  end: number;
  score: number;
  reasons: ScoreReason[];
  isCredit: boolean;
  hadCurrencyMarker: boolean;
}

function emphasisWeightAt(doc: ExtractedDocument, start: number, end: number): number {
  let weight = 0;
  for (const range of doc.emphasis) {
    if (range.start < end && range.end > start) weight = Math.max(weight, range.weight);
  }
  return weight;
}

interface RawSpan {
  numeric: string;
  currencyToken: string | undefined;
  start: number;
  end: number;
  raw: string;
}

/** Every money-like span in document order, longer/currency-marked spans winning overlaps. */
function collectSpans(text: string): RawSpan[] {
  const spans: RawSpan[] = [];
  const claimed: Array<[number, number]> = [];
  const claim = (start: number, end: number): boolean => {
    if (claimed.some(([a, b]) => start < b && end > a)) return false;
    claimed.push([start, end]);
    return true;
  };

  MONEY_SPAN_RE.lastIndex = 0;
  for (const match of text.matchAll(MONEY_SPAN_RE)) {
    const groups = match.groups ?? {};
    const numeric = groups.numA ?? groups.numB;
    if (!numeric) continue;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!claim(start, end)) continue;
    spans.push({ numeric, currencyToken: groups.pre ?? groups.post, start, end, raw: match[0] });
  }

  BARE_DECIMAL_RE.lastIndex = 0;
  for (const match of text.matchAll(BARE_DECIMAL_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!claim(start, end)) continue;
    spans.push({ numeric: match[0], currencyToken: undefined, start, end, raw: match[0] });
  }

  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Extracts every money-like span and scores it. Highest score wins.
 *
 * The scoring model that matters: a label binds to the *nearest* amount. "You saved ₹40"
 * sitting two lines above an order total must not sink that total, and "Avl Bal: ₹1,23,456"
 * must sink the balance sitting right after it. So a signal's weight is discounted by how
 * many other money spans lie between the phrase and the candidate.
 */
export function extractAmountCandidates(
  doc: ExtractedDocument,
  options: { defaultCurrency: string; localeHint?: string },
): AmountCandidate[] {
  const { defaultCurrency, localeHint = 'en-IN' } = options;
  const text = doc.text;
  const lower = text.toLowerCase();
  const spans = collectSpans(text);
  const spanStarts = spans.map((s) => s.start);
  const candidates: AmountCandidate[] = [];

  const spansBetween = (from: number, to: number): number => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return spanStarts.filter((position) => position > lo && position < hi).length;
  };

  for (const span of spans) {
    const currency = currencyFromToken(span.currencyToken, defaultCurrency);
    const parsed = parseAmountString(span.numeric, currency, localeHint);
    if (!parsed || parsed.minorUnits <= 0) continue;

    const windowStart = Math.max(0, span.start - SCORING_WINDOW);
    const windowEnd = Math.min(lower.length, span.end + SCORING_WINDOW);
    const window = lower.slice(windowStart, windowEnd);

    const reasons: ScoreReason[] = [];
    let score = 0;

    if (span.currencyToken) {
      score += 1.5;
      reasons.push({ label: 'currency marker', delta: 1.5 });
    }

    // Longest phrase first, consuming the text it matched: without this "you saved" also
    // fires "you save", and "amount paid" also fires "amount" and "paid".
    const consumed: Array<[number, number]> = [];
    const isFree = (from: number, to: number): boolean => !consumed.some(([a, b]) => from < b && to > a);

    for (const [phrase, weight] of ALL_SIGNALS) {
      let occurrence = -1;
      for (let at = window.indexOf(phrase); at !== -1; at = window.indexOf(phrase, at + 1)) {
        if (isFree(at, at + phrase.length)) {
          occurrence = at;
          consumed.push([at, at + phrase.length]);
          break;
        }
      }
      if (occurrence === -1) continue;

      const absolute = windowStart + occurrence;
      const before = absolute < span.start;
      const intervening = before
        ? spansBetween(absolute, span.start)
        : spansBetween(span.end, absolute + phrase.length);

      let factor: number;
      if (intervening > 0) factor = 0.15; // the label belongs to that other amount
      else if (before) factor = 1;
      else factor = weight > 0 ? 0.6 : 0.5; // trailing labels are weaker evidence

      const delta = weight * factor;
      if (Math.abs(delta) < 0.05) continue;
      score += delta;
      reasons.push({ label: `${weight > 0 ? '+' : ''}${phrase}`, delta: Number(delta.toFixed(2)) });
    }

    const emphasis = emphasisWeightAt(doc, span.start, span.end);
    if (emphasis > 0) {
      const delta = Math.min(1.5, emphasis * 0.75);
      score += delta;
      reasons.push({ label: 'typographic emphasis', delta: Number(delta.toFixed(2)) });
    }

    // Position: later "Total" lines usually win.
    if (text.length > 0) {
      const delta = Number(((span.start / text.length) * 0.8).toFixed(2));
      score += delta;
      if (delta >= 0.2) reasons.push({ label: 'late in document', delta });
    }

    // Table-row adjacency: "Total | ₹1,249" puts a label cell immediately before the value.
    const immediatelyBefore = lower.slice(windowStart, span.start);
    if (/\|\s*$/.test(immediatelyBefore) && POSITIVE_SIGNALS.some(([p]) => immediatelyBefore.includes(p))) {
      score += 1.0;
      reasons.push({ label: 'table label adjacency', delta: 1.0 });
    }

    const isCredit = CREDIT_SIGNALS.some((signal) => window.includes(signal)) && !window.includes('debited');

    candidates.push({
      minorUnits: parsed.minorUnits,
      currency,
      raw: span.raw.trim(),
      start: span.start,
      end: span.end,
      score: Number(score.toFixed(3)),
      reasons,
      isCredit,
      hadCurrencyMarker: Boolean(span.currencyToken),
    });
  }

  return candidates.sort((a, b) => b.score - a.score || b.minorUnits - a.minorUnits);
}

export interface CandidateSelection {
  best: AmountCandidate;
  runnerUp: AmountCandidate | null;
  /** Gap between the top two scores — the main input to L2 confidence. */
  margin: number;
}

export function selectAmount(candidates: AmountCandidate[]): CandidateSelection | null {
  if (candidates.length === 0) return null;
  const best = candidates[0] as AmountCandidate;
  const runnerUp = candidates[1] ?? null;
  return {
    best,
    runnerUp,
    margin: Number((best.score - (runnerUp?.score ?? 0)).toFixed(3)),
  };
}
