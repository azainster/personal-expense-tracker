/**
 * Golden-file fixtures (§7, Step 3: "save 30–50 real emails as fixtures with hand-labelled
 * expected output. This is the highest-leverage thing in Phase 1.").
 *
 * The same corpus is used three ways:
 *   1. the golden test suite asserts the pipeline's output against `expected`;
 *   2. `npm run seed` feeds it through the real pipeline so the dashboard has data
 *      before Gmail is connected;
 *   3. the debug route renders any single fixture's parse trace.
 *
 * Bodies use date tokens so fixtures stay relative to "today" — that keeps the seeded
 * dashboard populated forever and exercises date extraction rather than hard-coding it.
 */

export interface ExpectedParse {
  status: 'parsed';
  amountMinor: number;
  currency: string;
  merchantNormalized: string;
  categoryKey?: string;
  isCredit?: boolean;
  extractionMethod?: 'template' | 'jsonld' | 'regex' | 'llm-remote';
  accountLast4?: string;
  isTransfer?: boolean;
  /** Financial account/card the email belongs to, e.g. `hdfc_pixel_play`. */
  sourceKey?: string;
  txnKind?: 'debit' | 'credit' | 'refund' | 'transfer';
  referenceId?: string;
  txnTime?: string;
  /** Fixture id this one duplicates; the ingest test asserts it does not double-count. */
  duplicateOf?: string;
}

export interface ExpectedReject {
  status: 'rejected';
  /** Substring expected in the rejection reason. */
  reasonContains?: string;
}

export interface SampleEmail {
  id: string;
  from: string;
  subject: string;
  /** Age of the message in days; bodies are rendered relative to this. */
  daysAgo: number;
  text?: string;
  html?: string;
  expected: ExpectedParse | ExpectedReject;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Replaces date tokens with values derived from the message date:
 *   {{d-m-y2}}   03-09-26      {{d-m-y4}}   03-09-2026
 *   {{d/m/y4}}   03/09/2026    {{d-Mon-y2}} 03-Sep-26
 *   {{Mon d, y4}} Sep 3, 2026  {{iso}}      2026-09-03
 */
export function renderTokens(body: string, date: Date): string {
  const d = date.getUTCDate();
  const m = date.getUTCMonth();
  const y = date.getUTCFullYear();
  return body
    .replace(/\{\{d-m-y2\}\}/g, `${pad(d)}-${pad(m + 1)}-${String(y).slice(2)}`)
    .replace(/\{\{d-m-y4\}\}/g, `${pad(d)}-${pad(m + 1)}-${y}`)
    .replace(/\{\{d\/m\/y4\}\}/g, `${pad(d)}/${pad(m + 1)}/${y}`)
    .replace(/\{\{d-Mon-y2\}\}/g, `${pad(d)}-${MONTHS[m]}-${String(y).slice(2)}`)
    .replace(/\{\{Mon d, y4\}\}/g, `${MONTHS[m]} ${d}, ${y}`)
    .replace(/\{\{iso\}\}/g, `${y}-${pad(m + 1)}-${pad(d)}`);
}

export function fixtureDate(daysAgo: number, now = new Date()): Date {
  const date = new Date(now.getTime() - daysAgo * 86_400_000);
  // Noon UTC keeps day-floor dedupe keys stable regardless of the server timezone.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
}
