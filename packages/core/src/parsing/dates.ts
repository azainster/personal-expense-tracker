/**
 * Date extraction.
 *
 * §3: the email `Date` header is the *send* time, not the transaction time. Prefer a date
 * found in the body near transaction language; fall back to the header. (iOS would use
 * NSDataDetector here; this is the portable equivalent.)
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export interface DateCandidate {
  date: Date;
  index: number;
  raw: string;
  /** 'numeric' | 'month-name' | 'iso' — used to break ties. */
  shape: string;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function makeDate(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(expandYear(year), monthIndex, day, 12, 0, 0));
  if (d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null;
  return d;
}

const NUMERIC_RE = /\b(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
const DAY_MONTH_NAME_RE = /\b(\d{1,2})[\s-]?(?:st|nd|rd|th)?[\s-]([A-Za-z]{3,9})[\s,-]{0,2}(\d{2,4})?\b/g;
const MONTH_NAME_DAY_RE = /\b([A-Za-z]{3,9})[\s-](\d{1,2})(?:st|nd|rd|th)?[\s,]{0,2}(\d{2,4})?\b/g;

/** True when the locale writes month before day (en-US and friends). */
export function prefersMonthFirst(localeHint: string): boolean {
  return /^en-?US$/i.test(localeHint) || /^en$/i.test(localeHint);
}

export function findDates(text: string, localeHint = 'en-IN', referenceYear?: number): DateCandidate[] {
  const found: DateCandidate[] = [];
  const fallbackYear = referenceYear ?? new Date().getUTCFullYear();

  for (const match of text.matchAll(NUMERIC_RE)) {
    const [raw, aStr, bStr, cStr] = match;
    const a = Number(aStr);
    const b = Number(bStr);
    const c = Number(cStr);
    let date: Date | null = null;
    if ((aStr as string).length === 4) {
      date = makeDate(a, b - 1, c); // ISO: YYYY-MM-DD
    } else if (a > 12 && b <= 12) {
      date = makeDate(c, b - 1, a); // unambiguous DD/MM
    } else if (b > 12 && a <= 12) {
      date = makeDate(c, a - 1, b); // unambiguous MM/DD
    } else {
      date = prefersMonthFirst(localeHint) ? makeDate(c, a - 1, b) : makeDate(c, b - 1, a);
    }
    if (date) found.push({ date, index: match.index ?? 0, raw, shape: (aStr as string).length === 4 ? 'iso' : 'numeric' });
  }

  for (const match of text.matchAll(DAY_MONTH_NAME_RE)) {
    const [raw, dayStr, monthStr, yearStr] = match;
    const monthIndex = MONTHS[(monthStr as string).toLowerCase()];
    if (monthIndex === undefined) continue;
    const date = makeDate(yearStr ? Number(yearStr) : fallbackYear, monthIndex, Number(dayStr));
    if (date) found.push({ date, index: match.index ?? 0, raw, shape: 'month-name' });
  }

  for (const match of text.matchAll(MONTH_NAME_DAY_RE)) {
    const [raw, monthStr, dayStr, yearStr] = match;
    const monthIndex = MONTHS[(monthStr as string).toLowerCase()];
    if (monthIndex === undefined) continue;
    const date = makeDate(yearStr ? Number(yearStr) : fallbackYear, monthIndex, Number(dayStr));
    if (date) found.push({ date, index: match.index ?? 0, raw, shape: 'month-name' });
  }

  const seen = new Set<string>();
  return found
    .filter((c) => {
      const key = `${c.index}:${c.date.toISOString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.index - b.index);
}

/** Parses a single date string using a template-declared format hint. */
export function parseWithFormat(raw: string, format: string): Date | null {
  const cleaned = raw.trim();
  const upper = format.toUpperCase();
  const parts = cleaned.split(/[\s,./-]+/).filter(Boolean);
  const tokens = upper.split(/[\s,./-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length !== tokens.length) return null;

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    const value = parts[i] as string;
    if (token.startsWith('DD')) day = Number(value);
    else if (token.startsWith('MMM')) month = MONTHS[value.toLowerCase()] ?? null;
    else if (token.startsWith('MM')) month = Number(value) - 1;
    else if (token.startsWith('YY')) year = Number(value);
  }
  if (day === null || month === null || Number.isNaN(day) || Number.isNaN(month)) return null;
  return makeDate(year ?? new Date().getUTCFullYear(), month, day);
}

const TRANSACTION_DATE_WORDS = /\b(on|dated|date|transaction date|txn date|posted|order date|paid on)\b/gi;

export interface ChosenDate {
  date: Date;
  source: 'body-near-amount' | 'body' | 'header';
  raw?: string;
}

/**
 * Picks the transaction date. Body dates near the amount win; a body date more than a day
 * in the future relative to the header is rejected as a due-date / delivery-date false hit.
 */
export function chooseTransactionDate(options: {
  text: string;
  headerDate: Date;
  anchorIndex?: number;
  localeHint?: string;
}): ChosenDate {
  const { text, headerDate, anchorIndex, localeHint = 'en-IN' } = options;
  const candidates = findDates(text, localeHint, headerDate.getUTCFullYear());
  if (candidates.length === 0) return { date: headerDate, source: 'header' };

  const horizonForward = headerDate.getTime() + 36 * 3600 * 1000;
  const horizonBack = headerDate.getTime() - 120 * 24 * 3600 * 1000;

  const dateWordIndexes = [...text.matchAll(TRANSACTION_DATE_WORDS)].map((m) => m.index ?? 0);

  let best: { candidate: DateCandidate; score: number } | null = null;
  for (const candidate of candidates) {
    const t = candidate.date.getTime();
    if (t > horizonForward || t < horizonBack) continue;

    let score = 1;
    if (anchorIndex !== undefined) {
      const distance = Math.abs(candidate.index - anchorIndex);
      score += Math.max(0, 3 - distance / 80);
    }
    const nearWord = dateWordIndexes.some((i) => Math.abs(i - candidate.index) <= 24);
    if (nearWord) score += 2;
    if (candidate.shape === 'iso') score += 0.5;
    // Same calendar day as the header is corroboration, not coincidence.
    if (Math.abs(t - headerDate.getTime()) < 36 * 3600 * 1000) score += 1;

    if (!best || score > best.score) best = { candidate, score };
  }

  if (!best) return { date: headerDate, source: 'header' };
  return {
    date: best.candidate.date,
    source: anchorIndex !== undefined && Math.abs(best.candidate.index - anchorIndex) < 200 ? 'body-near-amount' : 'body',
    raw: best.candidate.raw,
  };
}
