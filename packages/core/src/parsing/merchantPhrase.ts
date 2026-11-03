/**
 * Merchant-phrase extraction for the L2 path.
 *
 * A bank template tells you where the merchant is. An arbitrary receipt does not, and
 * falling back to the sender domain turns "You paid ₹450 to Swiggy" from PhonePe into a
 * transaction with PhonePe as the merchant — wrong, and it breaks dedupe against the bank
 * alert for the same purchase.
 */

const NAME = "[A-Z][A-Za-z0-9&'’.\\-]*(?:[ ][A-Z0-9][A-Za-z0-9&'’.\\-]*){0,3}";

interface PhrasePattern {
  regex: RegExp;
  weight: number;
}

const BODY_PATTERNS: PhrasePattern[] = [
  { regex: new RegExp(`\\b(?:paid|payment|sent|transferred)\\s+(?:of\\s+\\S+\\s+)?to\\s+(${NAME})`), weight: 5 },
  { regex: new RegExp(`\\bpayment\\s+successful\\s+to\\s+(${NAME})`, 'i'), weight: 5 },
  { regex: new RegExp(`\\b(?:spent|charged|purchase|txn|transaction)\\s+(?:at|with)\\s+(${NAME})`), weight: 5 },
  { regex: new RegExp(`\\b(?:receipt|invoice|bill|order|booking)\\s+from\\s+(${NAME})`, 'i'), weight: 4 },
  { regex: new RegExp(`\\b(?:your\\s+)?order\\s+(?:#?\\w+\\s+)?from\\s+(${NAME})`, 'i'), weight: 4 },
  { regex: new RegExp(`\\bat\\s+(${NAME})\\s+on\\s+\\d`), weight: 3 },
  { regex: new RegExp(`\\bto\\s+VPA\\s+([\\w.\\-]+)`, 'i'), weight: 4 },
];

const SUBJECT_PATTERNS: PhrasePattern[] = [
  { regex: new RegExp(`^Your\\s+(${NAME})\\s+(?:receipt|order|invoice|bill|booking|trip)`, 'i'), weight: 4 },
  { regex: new RegExp(`\\b(?:receipt|invoice|bill)\\s+from\\s+(${NAME})`, 'i'), weight: 4 },
  { regex: new RegExp(`\\bpayment\\s+(?:successful\\s+)?to\\s+(${NAME})`, 'i'), weight: 4 },
  { regex: new RegExp(`\\btrip\\s+with\\s+(${NAME})`, 'i'), weight: 3 },
];

/** Words that end a merchant name when they follow it. */
const TRAILING_STOPWORDS = new Set([
  'on', 'for', 'dated', 'using', 'via', 'with', 'ref', 'is', 'was', 'has', 'successful',
  'and', 'the', 'your', 'you', 'order', 'transaction', 'payment', 'at', 'to', 'in',
]);

function tidy(candidate: string): string {
  const tokens = candidate.trim().replace(/[.,;:]+$/, '').split(/\s+/);
  const kept: string[] = [];
  for (const token of tokens) {
    if (TRAILING_STOPWORDS.has(token.toLowerCase()) && kept.length > 0) break;
    kept.push(token);
    if (kept.length >= 4) break;
  }
  return kept.join(' ').trim();
}

/**
 * Looks for a merchant name, preferring phrases close to the amount. Returns null when
 * nothing convincing is found so the caller can fall back to the sender.
 */
export function extractMerchantPhrase(options: {
  text: string;
  subject: string;
  anchorIndex?: number;
}): string | null {
  const { text, subject, anchorIndex } = options;
  let best: { value: string; score: number } | null = null;

  const consider = (raw: string | undefined, weight: number, index: number): void => {
    if (!raw) return;
    const value = tidy(raw);
    if (value.length < 2 || /^\d+$/.test(value)) return;
    let score = weight;
    if (anchorIndex !== undefined && index >= 0) {
      score += Math.max(0, 3 - Math.abs(index - anchorIndex) / 100);
    }
    if (!best || score > best.score) best = { value, score };
  };

  // Search a window around the amount first, then the whole body.
  const windows: Array<{ slice: string; offset: number }> = [];
  if (anchorIndex !== undefined) {
    const start = Math.max(0, anchorIndex - 160);
    windows.push({ slice: text.slice(start, Math.min(text.length, anchorIndex + 160)), offset: start });
  }
  windows.push({ slice: text, offset: 0 });

  for (const { slice, offset } of windows) {
    for (const { regex, weight } of BODY_PATTERNS) {
      const match = regex.exec(slice);
      if (match) consider(match[1], weight, offset + (match.index ?? 0));
    }
  }

  for (const { regex, weight } of SUBJECT_PATTERNS) {
    const match = regex.exec(subject);
    if (match) consider(match[1], weight - 0.5, anchorIndex ?? 0);
  }

  return best ? (best as { value: string }).value : null;
}

const GENERIC_LABELS = new Set([
  'mail', 'mailer', 'email', 'e', 'em', 'info', 'news', 'newsletter', 'notifications',
  'notification', 'alerts', 'alert', 'noreply', 'no-reply', 'reply', 'send', 'smtp',
  'mktg', 'marketing', 't', 'r', 'm', 'link', 'links', 'go', 'click', 'updates', 'update',
  'account', 'accounts', 'billing', 'orders', 'order', 'support', 'care', 'service',
  'services', 'web', 'www', 'secure', 'my', 'welcome', 'message', 'messages',
]);

const TLD_LABELS = new Set([
  'com', 'net', 'org', 'io', 'co', 'in', 'uk', 'us', 'de', 'fr', 'jp', 'au', 'ca', 'me',
  'app', 'dev', 'ai', 'biz', 'info', 'store', 'online', 'shop', 'cloud', 'tech', 'xyz',
  'fit', 'life', 'club', 'email', 'name', 'sg', 'ae', 'nl', 'es', 'it',
]);

/**
 * Candidate brand strings for a sender address, best first.
 * `info@mailer.netflix.com` → ["netflix", "mailernetflix", "mailer"]
 * `care@cult.fit`           → ["cultfit", "cult"]
 */
export function senderBrandCandidates(address: string): string[] {
  const at = address.lastIndexOf('@');
  const domain = (at >= 0 ? address.slice(at + 1) : address).toLowerCase();
  const labels = domain.split('.').filter(Boolean);
  if (labels.length === 0) return [];

  const withoutTld = [...labels];
  while (withoutTld.length > 1 && TLD_LABELS.has(withoutTld[withoutTld.length - 1] as string)) {
    withoutTld.pop();
  }

  const candidates: string[] = [];
  const meaningful = withoutTld.filter((label) => !GENERIC_LABELS.has(label));
  const brand = meaningful[meaningful.length - 1] ?? withoutTld[withoutTld.length - 1];

  // `cult.fit` is one brand split across a label boundary, so the dotless join is tried too.
  if (labels.length > 1) candidates.push(labels.slice(0, -1).join('') + (TLD_LABELS.has(labels[labels.length - 1] as string) ? '' : labels[labels.length - 1]));
  if (labels.length > 1) candidates.push(labels.join(''));
  if (withoutTld.length > 1) candidates.push(withoutTld.join(''));
  if (brand) candidates.push(brand);
  for (const label of withoutTld) candidates.push(label);

  return [...new Set(candidates)].filter((c) => c.length >= 2);
}
