/** Display formatting. Money is integer minor units until the moment it is drawn. */
import { formatMinor, minorUnitExponent } from '@expense/core';

function deviceLocale(): string {
  try {
    return Intl.NumberFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

const LOCALE = deviceLocale();

export function money(minor: number, currency: string, options: { signed?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(minor);
  let text: string;
  if (options.compact && abs / 10 ** minorUnitExponent(currency) >= 10_000) {
    try {
      text = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(
        abs / 10 ** minorUnitExponent(currency),
      );
    } catch {
      text = formatMinor(abs, currency, LOCALE);
    }
  } else {
    text = formatMinor(abs, currency, LOCALE);
  }
  if (minor < 0) return `−${text}`;
  if (options.signed && minor > 0) return `+${text}`;
  return text;
}

/** Whole units without decimals, for big dashboard numbers: ₹12,450. */
export function moneyRounded(minor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  try {
    const text = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(
      Math.abs(minor) / 10 ** exponent,
    );
    return minor < 0 ? `−${text}` : text;
  } catch {
    return money(minor, currency);
  }
}

export function shortDate(iso: string): string {
  const date = new Date(iso);
  try {
    return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

export function longDate(iso: string): string {
  const date = new Date(iso);
  try {
    return date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export function dayHeading(isoDay: string, now = new Date()): string {
  const today = localDayKey(now.toISOString());
  const yesterday = localDayKey(new Date(now.getTime() - 86_400_000).toISOString());
  if (isoDay === today) return 'Today';
  if (isoDay === yesterday) return 'Yesterday';
  const [y, m, d] = isoDay.split('-').map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  try {
    return date.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return isoDay;
  }
}

/** YYYY-MM-DD in the device's local time zone. */
export function localDayKey(iso: string): string {
  const date = new Date(iso);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function percent(share: number): string {
  if (share > 0 && share < 0.01) return '<1%';
  return `${Math.round(share * 100)}%`;
}

const METHOD_LABELS: Record<string, string> = {
  template: 'Known sender template',
  jsonld: 'Structured data in the email',
  regex: 'Scored amount extraction',
  'llm-remote': 'AI fallback (redacted)',
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}
