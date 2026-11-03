/**
 * Currency parsing.
 *
 * Rules from §3 of the architecture:
 *  - money is `Int` minor units + an ISO-4217 code, never a float;
 *  - Indian grouping (1,23,456.78) must parse, not just 3-digit grouping;
 *  - symbol may lead or trail;
 *  - `1.234` is ambiguous — resolve with a group-size heuristic plus a locale hint.
 */

/** ISO-4217 exponents that are not 2. */
const EXPONENT_OVERRIDES: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, IDR: 0, XAF: 0, XOF: 0, PYG: 0, RWF: 0, UGX: 0, VUV: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function minorUnitExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

/** Symbols and textual prefixes → ISO code. `$` alone is deliberately ambiguous. */
const SYMBOL_TO_CURRENCY: Array<[string, string]> = [
  ['₹', 'INR'], ['Rs.', 'INR'], ['Rs', 'INR'], ['INR', 'INR'], ['₨', 'INR'],
  ['US$', 'USD'], ['USD', 'USD'], ['$', 'USD'],
  ['€', 'EUR'], ['EUR', 'EUR'],
  ['£', 'GBP'], ['GBP', 'GBP'],
  ['¥', 'JPY'], ['JPY', 'JPY'],
  ['AED', 'AED'], ['SGD', 'SGD'], ['AUD', 'AUD'], ['CAD', 'CAD'], ['CHF', 'CHF'], ['SAR', 'SAR'],
];

const CURRENCY_TOKEN_RE =
  '(?:US\\$|Rs\\.?|INR|USD|EUR|GBP|JPY|AED|SGD|AUD|CAD|CHF|SAR|[₹₨$€£¥])';

const NUMBER_RE = '\\d{1,3}(?:[.,\\u00A0\\u202F]\\d{2,3})*(?:[.,]\\d{1,3})?|\\d+(?:[.,]\\d{1,3})?';

/** Currency-marked span, either prefix or suffix. Used by the L2 candidate scanner. */
export const MONEY_SPAN_RE = new RegExp(
  `(?:(?<pre>${CURRENCY_TOKEN_RE})\\s*(?<numA>${NUMBER_RE}))|(?:(?<numB>${NUMBER_RE})\\s*(?<post>${CURRENCY_TOKEN_RE})(?![A-Za-z]))`,
  'gi',
);

/** Bare decimals like `1,249.00` with no symbol — weaker candidates, still worth scoring. */
export const BARE_DECIMAL_RE = /\d{1,3}(?:[.,]\d{2,3})*[.,]\d{2}\b/g;

export function currencyFromToken(token: string | undefined, fallback: string): string {
  if (!token) return fallback;
  const cleaned = token.trim().toUpperCase().replace(/\s+/g, '');
  for (const [sym, code] of SYMBOL_TO_CURRENCY) {
    if (sym.toUpperCase() === cleaned) return code;
  }
  if (cleaned.startsWith('RS')) return 'INR';
  return fallback;
}

export interface ParsedAmount {
  /** Integer minor units, e.g. 124900 for 1,249.00 INR. */
  minorUnits: number;
  /** How the separators were interpreted — useful in the debug view and in tests. */
  interpretation: 'decimal' | 'grouping-only' | 'integer';
}

function roundHalfUp(digits: string, keep: number): string {
  if (digits.length <= keep) return digits.padEnd(keep, '0');
  const kept = digits.slice(0, keep);
  const next = digits.charCodeAt(keep) - 48;
  if (next < 5) return kept;
  const bumped = (BigInt(kept === '' ? '0' : kept) + 1n).toString();
  return bumped.padStart(keep, '0');
}

/**
 * Parses the numeric portion of a money span into minor units.
 * `localeHint` only breaks genuine ties; it never overrides an unambiguous layout.
 */
export function parseAmountString(
  raw: string,
  currency: string,
  localeHint = 'en-IN',
): ParsedAmount | null {
  const exponent = minorUnitExponent(currency);
  const text = raw.replace(/[  \s]/g, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;

  const separators = text.match(/[.,]/g) ?? [];
  if (separators.length === 0) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return { minorUnits: Math.round(n * 10 ** exponent), interpretation: 'integer' };
  }

  const groups = text.split(/[.,]/);
  const lastSep = text.match(/[.,](?=[^.,]*$)/)?.[0] ?? '.';
  const distinct = new Set(separators);
  const tail = groups[groups.length - 1] ?? '';

  let decimalIndex: number; // index into `groups` where the fraction starts, or -1

  if (distinct.size === 2) {
    // Both separators present: the rightmost is the decimal separator.
    decimalIndex = groups.length - 1;
  } else if (separators.length > 1) {
    // One separator repeated → pure grouping (1,23,456 or 1.234.567).
    decimalIndex = -1;
  } else if (tail.length <= 2) {
    decimalIndex = groups.length - 1;
  } else if (tail.length === 3) {
    // The ambiguous case. Three trailing digits after a lone separator is far more
    // often thousands grouping than a 3-decimal amount — unless the currency really
    // does have 3 minor digits, or the locale's decimal separator is the one used and
    // the leading group is itself not a valid group size.
    if (exponent === 3) {
      decimalIndex = groups.length - 1;
    } else {
      const localeDecimal = decimalSeparatorForLocale(localeHint);
      const head = groups[0] ?? '';
      decimalIndex = lastSep === localeDecimal && head.length > 3 ? groups.length - 1 : -1;
    }
  } else {
    decimalIndex = groups.length - 1;
  }

  let integerDigits: string;
  let fractionDigits: string;
  if (decimalIndex === -1) {
    integerDigits = groups.join('');
    fractionDigits = '';
  } else {
    integerDigits = groups.slice(0, decimalIndex).join('');
    fractionDigits = groups[decimalIndex] ?? '';
  }

  if (integerDigits === '' || !/^\d+$/.test(integerDigits)) return null;
  if (fractionDigits !== '' && !/^\d+$/.test(fractionDigits)) return null;

  const minorStr = integerDigits + roundHalfUp(fractionDigits, exponent);
  const minorUnits = Number(minorStr.replace(/^0+(?=\d)/, ''));
  if (!Number.isSafeInteger(minorUnits)) return null;

  return {
    minorUnits,
    interpretation: decimalIndex === -1 ? 'grouping-only' : 'decimal',
  };
}

function decimalSeparatorForLocale(locale: string): '.' | ',' {
  const commaDecimalLocales = /^(de|fr|es|it|pt|nl|tr|ru|pl|sv|da|nb|fi|cs|id|vi|uk|ro|el|hu)/i;
  return commaDecimalLocales.test(locale) ? ',' : '.';
}

export function formatMinor(minorUnits: number, currency: string, locale = 'en-IN'): string {
  const exponent = minorUnitExponent(currency);
  const value = minorUnits / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(exponent)}`;
  }
}

export function majorUnits(minorUnits: number, currency: string): number {
  return minorUnits / 10 ** minorUnitExponent(currency);
}

export function toMinorUnits(major: number, currency: string): number {
  return Math.round(major * 10 ** minorUnitExponent(currency));
}
