/**
 * L0 — sender fingerprint → template (§3).
 *
 * "Hash the From address against the rules pack. A direct hit means you know exactly where
 * the amount lives. ~70% of volume, ~99% accuracy, sub-millisecond."
 */
import type { SenderRule, SenderTemplate } from './rulespack.js';
import type { TransactionKind } from './types.js';
import { normalizeClockTime } from './transactionMeta.js';
import { currencyFromToken, parseAmountString } from './money.js';
import { parseWithFormat } from './dates.js';

export interface TemplateExtraction {
  templateId: string;
  minorUnits: number;
  currency: string;
  merchantRaw?: string;
  accountLast4?: string;
  occurredAt?: Date;
  isCredit: boolean;
  confidence: number;
  /** Financial source this template belongs to, when it identifies one product only. */
  sourceKey?: string;
  txnKind?: TransactionKind;
  /** Bank reference (`ref` group), e.g. a UPI reference number. */
  referenceId?: string;
  /** Wall-clock time as printed in the email (`time` group), e.g. `08:45`. */
  txnTime?: string;
  /** UPI address from the `vpa` group, e.g. `8279535756@ptsbi`. */
  vpa?: string;
}

function tryTemplate(
  template: SenderTemplate,
  sender: SenderRule,
  text: string,
  defaultCurrency: string,
): TemplateExtraction | null {
  const regex = new RegExp(template.regex.source, template.regex.flags.includes('g') ? template.regex.flags : `${template.regex.flags}`);
  const match = regex.exec(text);
  if (!match) return null;

  const groups = match.groups ?? {};
  if (!groups.amount) return null;

  const currency = (template.currency ?? currencyFromToken(groups.currency, sender.defaultCurrency ?? defaultCurrency)).toUpperCase();
  const amount = parseAmountString(groups.amount, currency, 'en-IN');
  if (!amount || amount.minorUnits <= 0) return null;

  const result: TemplateExtraction = {
    templateId: template.id,
    minorUnits: amount.minorUnits,
    currency,
    isCredit: template.isCredit,
    confidence: template.confidence,
  };

  if (template.sourceKey) result.sourceKey = template.sourceKey;
  if (template.txnKind) result.txnKind = template.txnKind;

  const reference = groups.ref?.trim();
  if (reference) result.referenceId = reference.toUpperCase();

  const time = normalizeClockTime(groups.time);
  if (time) result.txnTime = time;

  const vpa = groups.vpa?.trim();
  if (vpa) result.vpa = vpa;

  const merchant = groups.merchant?.trim();
  if (merchant) result.merchantRaw = merchant.replace(/\s+/g, ' ');
  else if (sender.merchantName) result.merchantRaw = sender.merchantName;

  if (groups.last4) result.accountLast4 = groups.last4;

  if (groups.date) {
    const parsed = template.dateFormat ? parseWithFormat(groups.date, template.dateFormat) : null;
    if (parsed) result.occurredAt = parsed;
    else {
      const fallback = new Date(groups.date);
      if (!Number.isNaN(fallback.getTime())) result.occurredAt = fallback;
    }
  }

  return result;
}

/** Runs every template for a matched sender, returning the highest-confidence hit. */
export function applySenderTemplates(
  sender: SenderRule,
  text: string,
  defaultCurrency: string,
): TemplateExtraction | null {
  let best: TemplateExtraction | null = null;
  for (const template of sender.templates) {
    const hit = tryTemplate(template, sender, text, defaultCurrency);
    if (hit && (!best || hit.confidence > best.confidence)) best = hit;
  }
  return best;
}
