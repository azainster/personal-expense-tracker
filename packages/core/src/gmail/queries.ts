/**
 * Gmail search queries (§2.2).
 *
 * `messages.list` returns IDs only and every body costs a separate `messages.get`, so the
 * whole game is making `list` precise enough that irrelevant mail is rarely fetched.
 */
import type { RulesPack } from '../parsing/rulespack.js';

/** `q` has a practical length ceiling — chunk large from:() lists. */
export const SENDERS_PER_QUERY = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tier 1 — allowlist. High precision, runs every sync. */
export function tier1Queries(pack: RulesPack, extraSenders: string[] = [], windowDays = 35): string[] {
  const addresses = new Set<string>();
  for (const sender of pack.senders) for (const address of sender.addresses) addresses.add(address);
  for (const address of extraSenders) addresses.add(address.toLowerCase());
  if (addresses.size === 0) return [];

  return chunk([...addresses], SENDERS_PER_QUERY).map(
    (group) => `from:(${group.join(' OR ')}) newer_than:${windowDays}d -in:spam -in:trash`,
  );
}

/** Tier 2 — discovery sweep. Low precision, runs weekly / at onboarding. */
export function tier2Query(pack: RulesPack, windowDays = 35, excludePromotions = true): string {
  const subjects = pack.discoveryHints.subjectTerms.map((term) => (term.includes(' ') ? `"${term}"` : term)).join(' OR ');
  const phrases = pack.discoveryHints.bodyPhrases.map((phrase) => `"${phrase}"`).join(' OR ');
  const exclusions = ['-in:spam', '-in:trash', '-category:social'];
  // Some banks' mail lands in Promotions — the sweep can be run once without this to measure.
  if (excludePromotions) exclusions.push('-category:promotions');
  return `(subject:(${subjects}) OR ${phrases}) newer_than:${windowDays}d ${exclusions.join(' ')}`;
}

/** Subject-only triage used after the cheap `format=metadata` fetch. */
const SUBJECT_REJECT = [
  /\bnewsletter\b/i, /\bunsubscribe\b/i, /\bwebinar\b/i, /\bsurvey\b/i,
  /\b\d+% off\b/i, /\bsale\b/i, /\bdeal of\b/i, /\bcoupon\b/i,
  /\bpassword\b/i, /\bverify your\b/i, /\bsecurity alert\b/i, /\bOTP\b/,
  /\bstatement is ready\b/i, /\bdelivery (?:update|delayed)\b/i, /\bout for delivery\b/i,
];

const SUBJECT_ACCEPT = [
  /receipt/i, /invoice/i, /debited/i, /credited/i, /transaction/i, /order confirm/i,
  /payment/i, /you paid/i, /purchase/i, /spent/i, /charged/i, /bill/i, /trip with/i, /your order/i,
];

/** True when a subject is worth a full-body fetch. Known senders bypass this. */
export function subjectSurvivesTriage(subject: string, knownSender: boolean): boolean {
  if (knownSender) return true;
  if (SUBJECT_ACCEPT.some((re) => re.test(subject))) return true;
  if (SUBJECT_REJECT.some((re) => re.test(subject))) return false;
  return false;
}
