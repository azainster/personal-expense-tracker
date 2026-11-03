/** Pure helpers for build configuration — unit tested without React Native. */

const IOS_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

/**
 * Google's iOS OAuth redirect is the client ID in reverse-DNS form used as a custom URL
 * scheme: `1234-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.1234-abc:/oauth2redirect`.
 */
export function deriveGoogleRedirect(clientId: string): { scheme: string; redirectUri: string } | null {
  const id = clientId.trim();
  if (!IOS_CLIENT_ID_RE.test(id)) return null;
  const scheme = id.split('.').reverse().join('.');
  return { scheme, redirectUri: `${scheme}:/oauth2redirect` };
}

/** Trims, strips trailing slashes, and rejects anything that is not an http(s) URL. */
export function normalizeApiUrl(raw: string): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (value === '') return null;
  if (!/^https?:\/\/[^\s/]+/i.test(value)) return null;
  return value;
}

/** "Last synced 5 min ago" style relative time. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(then)) return 'never';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** `2026-09` → { year: 2026, monthIndex: 8 } */
export function parseMonthKey(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-');
  return { year: Number(y), monthIndex: Number(m) - 1 };
}

export function shiftMonthKey(month: string, delta: number): string {
  const { year, monthIndex } = parseMonthKey(month);
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  return date.toISOString().slice(0, 7);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(month: string, currentMonth?: string): string {
  const { year, monthIndex } = parseMonthKey(month);
  const name = MONTH_NAMES[monthIndex] ?? month;
  const currentYear = currentMonth ? parseMonthKey(currentMonth).year : new Date().getFullYear();
  return year === currentYear ? name : `${name} ${year}`;
}
