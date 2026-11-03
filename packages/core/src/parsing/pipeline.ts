/**
 * The L0 → L4 parsing cascade (§3 of the architecture).
 *
 *   L0  sender fingerprint → template   (fast, exact, ~70% of volume)
 *   L1  JSON-LD / schema.org            (typed, no regex risk)
 *   L2  scored candidate extraction     (the workhorse)
 *   L4  remote LLM, opt-in and redacted (L3 in the iOS design is on-device)
 *
 * Each stage produces an amount, a currency, and optionally a merchant / date / card;
 * everything after that — normalization, categorization, dedupe key — is shared.
 */
import type { Logger } from '../logger.js';
import type { LlmProvider } from '../llm/contract.js';
import { MAX_MODEL_INPUT_TOKENS } from '../llm/contract.js';
import { htmlToDocument, plainTextToDocument, truncateForModel, type ExtractedDocument } from './html.js';
import { redactForModel } from './redact.js';
import { extractAmountCandidates, selectAmount } from './candidates.js';
import { extractFromJsonLd } from './jsonld.js';
import { applySenderTemplates } from './template.js';
import { chooseTransactionDate } from './dates.js';
import { inferMerchantFromSender, normalizeMerchant } from './merchant.js';
import { extractMerchantPhrase, senderBrandCandidates } from './merchantPhrase.js';
import { categorize, detectTransfer, type MerchantRuleRecord } from './categorize.js';
import { computeDedupeKey } from './dedupe.js';
import { PARSER_VERSION, UNKNOWN_SOURCE_KEY, matchSender, templatesForSource, type RulesPack } from './rulespack.js';
import { identifyFinancialSource, sourceFromMerchantHint, type FinancialSourceIdentification } from './sources.js';
import { deriveTransactionKind, extractClockTime, extractReferenceId } from './transactionMeta.js';
import type { EmailMessage, ExtractionMethod, ParseDebug, ParseResult, ParsedTransaction } from './types.js';

/**
 * Recorded when the merchant could not be read from the email and was guessed from the sender
 * instead ("hdfcbank" for a bank alert). Such a name is not a real merchant, so a category
 * chosen for one of these must never be applied to the others or learned as a merchant rule.
 */
export const MERCHANT_FROM_SENDER_REASON = 'merchant inferred from sender';

/** Below this the transaction is stored but flagged for review. */
export const REVIEW_THRESHOLD = 0.6;
/** Below this the email is not considered a transaction at all. */
export const REJECT_THRESHOLD = 0.35;
/** At or above this, the deterministic cascade is trusted and L4 is never called. */
export const LLM_ESCALATION_THRESHOLD = 0.55;

const MARKETING_MARKERS = [
  'unsubscribe to stop', 'limited time offer', 'shop now', 'flat % off', 'use code',
  'exclusive deal', 'sale ends', 'don’t miss', 'apply now', 'pre-approved',
];
const STATEMENT_MARKERS = [
  'statement summary', 'minimum amount due', 'total amount due', 'statement period',
  'billing cycle', 'payment due date', 'your monthly statement', 'e-statement',
];
const TRANSACTION_MARKERS = [
  'debited', 'credited', 'spent', 'charged', 'you paid', 'payment of', 'has been made',
  'order total', 'total paid', 'amount paid', 'grand total', 'bill total', 'total charged',
  'receipt', 'invoice', 'transaction', 'purchase', 'payment successful', 'payment received',
  'order confirmation', 'fare', 'recharge', 'amount of',
];

/** An unknown sender with no transaction wording must clear a higher bar at L2. */
const WEAK_SENDER_MIN_SCORE = 3.0;

/** Content-free shape of a subject line, for failure telemetry. Never the subject itself. */
export function subjectShape(subject: string): string {
  return subject
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map((token) => {
      if (/^[₹$€£]|^(?:rs\.?|inr|usd)$/i.test(token)) return 'Cur';
      if (/^\d[\d,.]*$/.test(token)) return 'Num';
      if (/^[A-Za-z]+$/.test(token)) return 'Word';
      if (/^[A-Za-z0-9]+$/.test(token)) return 'Alnum';
      return 'Punct';
    })
    .join('-');
}

function senderDomainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : 'unknown';
}

function buildDocument(message: EmailMessage): ExtractedDocument {
  if (message.textBody && message.textBody.trim() !== '') {
    const doc = plainTextToDocument(message.textBody);
    // A plain-text part rarely carries JSON-LD, but the HTML alternative may.
    if (message.htmlBody) {
      const htmlDoc = htmlToDocument(message.htmlBody);
      return { ...doc, jsonLdBlocks: htmlDoc.jsonLdBlocks, tableRows: htmlDoc.tableRows };
    }
    return doc;
  }
  if (message.htmlBody && message.htmlBody.trim() !== '') return htmlToDocument(message.htmlBody);
  return plainTextToDocument(message.snippet ?? '');
}

function countMarkers(haystack: string, markers: string[]): number {
  return markers.reduce((total, marker) => (haystack.includes(marker) ? total + 1 : total), 0);
}

export interface PipelineDeps {
  pack: RulesPack;
  lookupMerchantRule: (normalizedName: string) => MerchantRuleRecord | null;
  /** Category keys that are excluded from spend totals (transfers, income). */
  excludedCategories: Set<string>;
  /** Currency assumed when a sender is unknown and the email names none. */
  defaultCurrency: string;
  /** Locale hint used to break genuine decimal-separator ties, e.g. `1.234`. */
  localeHint: string;
  /**
   * L4 remote model, opt-in. Absent or null means the cascade stops at L2. Whatever is passed
   * here only ever receives redacted, truncated text — redaction happens in this function.
   */
  llm?: LlmProvider | null;
  logger?: Logger;
}

export async function parseEmail(message: EmailMessage, deps: PipelineDeps): Promise<ParseResult> {
  const { pack } = deps;
  // I build one normalized document up front so every parser stage works from the same input.
  const doc = buildDocument(message);
  const haystack = `${message.subject}\n${doc.text}`.toLowerCase();
  const sender = matchSender(pack, message.senderAddress);
  const senderDomain = senderDomainOf(message.senderAddress);

  const debug: ParseDebug = {
    senderRuleId: sender?.id ?? null,
    senderKind: sender?.kind ?? null,
    stages: [],
    textLength: doc.text.length,
    amountCandidates: [],
    cleanedText: doc.text.slice(0, 4000),
  };

  const reject = (reason: string, stage: string): ParseResult => ({
    status: 'rejected',
    reason,
    stageReached: stage,
    subjectShape: subjectShape(message.subject),
    senderDomain,
    debug,
  });

  // I reject empty messages early because there is nothing useful for the later stages to score.
  if (doc.text.trim() === '' && (message.snippet ?? '') === '') {
    return reject('empty body', 'triage');
  }

  // Triage. Known senders are trusted; unknown senders must look transactional at all.
  const transactionMarkers = countMarkers(haystack, TRANSACTION_MARKERS);
  const statementMarkers = countMarkers(haystack, STATEMENT_MARKERS);
  const marketingMarkers = countMarkers(haystack, MARKETING_MARKERS);
  debug.stages.push(`triage(tx=${transactionMarkers},stmt=${statementMarkers},mkt=${marketingMarkers})`);

  if (statementMarkers >= 2 && transactionMarkers < 2) {
    return reject('looks like a statement summary, not a single transaction', 'triage');
  }
  if (!sender && marketingMarkers >= 2 && transactionMarkers < 2) {
    return reject('marketing email', 'triage');
  }
  // An unknown sender with no transaction wording is not rejected outright — a strongly
  // scored, currency-marked amount can still carry it. The bar is applied at L2 instead.
  const weakSender = !sender && transactionMarkers === 0;

  const defaultCurrency = sender?.defaultCurrency ?? deps.defaultCurrency;

  let amountMinor: number | null = null;
  let currency = defaultCurrency;
  let isCredit = false;
  let merchantRaw = '';
  let accountLast4: string | null = null;
  let occurredAt: Date | null = null;
  let method: ExtractionMethod = 'regex';
  let baseConfidence = 0;
  const reasons: string[] = [];
  let anchorIndex: number | undefined;
  // Evidence a matched template gives us about the account, kind, reference and time.
  let templateSourceKey: string | undefined;
  let templateKind: ParsedTransaction['txnKind'] | undefined;
  let referenceId: string | null = null;
  let txnTime: string | null = null;
  let counterpartyVpa: string | null = null;

  // ── Which account or card? Decided before anything is parsed ─────────────────
  // Wording decides, not the address: HDFC sends the bank account's and the Pixel Play card's
  // alerts from one address, and every Pixel email also says "Greetings from HDFC Bank!".
  let financialSource: FinancialSourceIdentification = identifyFinancialSource({
    pack,
    senderAddress: message.senderAddress,
    fromHeader: message.from,
    subject: message.subject,
    text: doc.text,
    senderDefaultSourceKey: sender?.defaultSourceKey,
  });
  debug.stages.push(`source(${financialSource.sourceKey}:${financialSource.reason})`);

  // ── L0 — sender fingerprint → template ────────────────────────────────────────
  // Only the identified account's templates may run, so a Pixel Play email is never read by
  // a bank-account template.
  if (sender) {
    const allowed = templatesForSource(sender, financialSource.sourceKey);
    const hit = applySenderTemplates({ ...sender, templates: allowed }, doc.text, defaultCurrency);
    debug.stages.push(`L0(${sender.id}:${hit ? hit.templateId : 'miss'})`);
    if (hit) {
      amountMinor = hit.minorUnits;
      currency = hit.currency;
      isCredit = hit.isCredit;
      merchantRaw = hit.merchantRaw ?? sender.merchantName ?? sender.issuer;
      accountLast4 = hit.accountLast4 ?? null;
      occurredAt = hit.occurredAt ?? null;
      method = 'template';
      baseConfidence = hit.confidence;
      debug.templateId = hit.templateId;
      reasons.push(`template ${hit.templateId}`);
      templateSourceKey = hit.sourceKey;
      templateKind = hit.txnKind;
      referenceId = hit.referenceId ?? null;
      txnTime = hit.txnTime ?? null;
      counterpartyVpa = hit.vpa ?? null;
      // "towards VPA 82795...@ptsbi (Mohd Asurul)" — the readable name is the payee; with no
      // name, the VPA itself is all the email offers.
      if (!merchantRaw && counterpartyVpa) merchantRaw = counterpartyVpa;
    }
  }

  if (templateSourceKey && templateSourceKey !== financialSource.sourceKey) {
    const rule = pack.financialSourcesByKey.get(templateSourceKey);
    if (rule) {
      financialSource = { sourceKey: rule.key, label: rule.label, shortLabel: rule.shortLabel, confidence: 0.99, reason: 'sender template' };
    }
  }

  // ── L1 — structured data in the HTML ──────────────────────────────────────────
  if (amountMinor === null && doc.jsonLdBlocks.length > 0) {
    const jsonLd = extractFromJsonLd(doc.jsonLdBlocks, defaultCurrency);
    debug.stages.push(`L1(${doc.jsonLdBlocks.length} blocks:${jsonLd ? jsonLd.type : 'miss'})`);
    if (jsonLd) {
      amountMinor = jsonLd.minorUnits;
      currency = jsonLd.currency;
      merchantRaw = jsonLd.merchant ?? sender?.merchantName ?? '';
      occurredAt = jsonLd.occurredAt ?? null;
      method = 'jsonld';
      baseConfidence = 0.92;
      reasons.push(`schema.org ${jsonLd.type}`);
    }
  } else if (amountMinor === null) {
    debug.stages.push('L1(no json-ld)');
  }

  // ── L2 — scored candidate extraction ──────────────────────────────────────────
  const candidates = extractAmountCandidates(doc, { defaultCurrency, localeHint: deps.localeHint });
  debug.amountCandidates = candidates.slice(0, 8).map((c) => ({
    raw: c.raw,
    minorUnits: c.minorUnits,
    currency: c.currency,
    score: c.score,
    reasons: c.reasons.map((r) => `${r.label}(${r.delta > 0 ? '+' : ''}${r.delta})`),
  }));

  if (amountMinor === null) {
    const selection = selectAmount(candidates);
    debug.stages.push(`L2(${candidates.length} candidates)`);
    const minScore = weakSender ? WEAK_SENDER_MIN_SCORE : 0;
    if (selection && selection.best.score > minScore) {
      const { best, margin } = selection;
      amountMinor = best.minorUnits;
      currency = best.currency;
      isCredit = best.isCredit;
      anchorIndex = best.start;
      method = 'regex';
      let score = 0.25 + best.score * 0.06 + Math.min(margin, 6) * 0.05;
      if (!best.hadCurrencyMarker) score *= 0.85;
      baseConfidence = Math.max(0, Math.min(0.9, score));
      reasons.push(`scored candidate ${best.score} (margin ${margin})`);
      merchantRaw = merchantRaw || sender?.merchantName || '';
    }
  } else {
    // Even when L0/L1 answered, keep the candidate list for the debug screen.
    const matching = candidates.find((c) => c.minorUnits === amountMinor);
    if (matching) anchorIndex = matching.start;
  }

  // ── L4 — remote LLM, opt-in ───────────────────────────────────────────────────
  if ((amountMinor === null || baseConfidence < LLM_ESCALATION_THRESHOLD) && deps.llm) {
    let llm = null;
    try {
      llm = await deps.llm.extract({
        subject: redactForModel(message.subject),
        senderDomain,
        text: truncateForModel(redactForModel(doc.text), MAX_MODEL_INPUT_TOKENS),
        defaultCurrency,
      });
    } catch (err) {
      deps.logger?.warn('remote model extraction failed', { err: err instanceof Error ? err.message : String(err) });
    }
    debug.stages.push(`L4(${llm ? `conf ${llm.confidence}` : 'miss'})`);
    if (llm && llm.confidence >= 0.3 && llm.confidence * 0.9 > baseConfidence) {
      amountMinor = llm.minorUnits;
      currency = llm.currency;
      isCredit = llm.isCredit;
      if (llm.merchant) merchantRaw = llm.merchant;
      method = 'llm-remote';
      baseConfidence = Math.min(0.85, llm.confidence * 0.9);
      reasons.push(`remote model confidence ${llm.confidence}`);
    }
  }

  if (amountMinor === null || amountMinor <= 0) {
    return reject(
      weakSender ? 'no transaction language and no strongly scored amount' : 'no amount candidate survived scoring',
      method === 'regex' ? 'L2' : method,
    );
  }

  // ── Shared post-processing ────────────────────────────────────────────────────
  if (!occurredAt) {
    const chosen = chooseTransactionDate({
      text: doc.text,
      headerDate: message.headerDate,
      ...(anchorIndex !== undefined ? { anchorIndex } : {}),
      localeHint: deps.localeHint,
    });
    occurredAt = chosen.date;
    debug.dateSource = chosen.source;
    if (chosen.source === 'header') reasons.push('date from email header');
  } else {
    debug.dateSource = 'template';
  }

  // A processor (Stripe, a UPI app) is not the merchant; nor is an unknown sender's domain
  // when the body names who was actually paid.
  const senderNamesMerchant = Boolean(sender?.merchantName);
  let merchantIsExplicit = merchantRaw.trim() !== '' && !senderNamesMerchant;
  if (!merchantRaw || merchantRaw.trim() === '' || (!senderNamesMerchant && sender?.kind !== 'bank')) {
    const phrase = extractMerchantPhrase({
      text: doc.text,
      subject: message.subject,
      ...(anchorIndex !== undefined ? { anchorIndex } : {}),
    });
    if (phrase && (!merchantRaw || merchantRaw.trim() === '' || !senderNamesMerchant)) {
      merchantRaw = phrase;
      merchantIsExplicit = true;
      reasons.push('merchant from body phrase');
    }
  }

  let merchant = merchantRaw && merchantRaw.trim() !== '' ? normalizeMerchant(merchantRaw, pack) : null;

  // Only guess from the sender domain when nothing in the email named the merchant —
  // otherwise a Stripe receipt for Linear becomes a Stripe transaction.
  if (!merchant || merchant.normalized === '' || (!merchant.matchedDictionary && !senderNamesMerchant && !merchantIsExplicit)) {
    const inferred = inferMerchantFromSender(message.senderAddress, pack, senderBrandCandidates(message.senderAddress));
    if (inferred && (!merchant || merchant.normalized === '' || (inferred.matchedDictionary && !merchant.matchedDictionary))) {
      merchant = inferred;
      merchantRaw = merchantRaw && merchantRaw.trim() !== '' ? merchantRaw : inferred.raw;
      reasons.push(MERCHANT_FROM_SENDER_REASON);
      baseConfidence *= 0.97;
    }
  }

  if (!merchant || merchant.normalized === '') {
    merchantRaw = sender?.merchantName ?? sender?.issuer ?? senderDomain;
    merchant = normalizeMerchant(merchantRaw, pack);
    baseConfidence *= 0.95;
  }

  const isTransfer = detectTransfer(doc.text, pack);

  // A vendor's own invoice names no account; `merchantSourceHints` says which card pays it.
  if (financialSource.sourceKey === UNKNOWN_SOURCE_KEY) {
    const hinted = sourceFromMerchantHint(pack, merchant.normalized);
    if (hinted) financialSource = hinted;
  }
  // A UPI-style payee is also worth keeping as payment metadata.
  if (!counterpartyVpa && /^[^\s@]{2,}@[A-Za-z0-9-]{2,}$/.test(merchantRaw.trim())) {
    counterpartyVpa = merchantRaw.trim();
  }
  debug.financialSource = financialSource.sourceKey;
  debug.financialSourceReason = financialSource.reason;
  if (financialSource.sourceKey !== UNKNOWN_SOURCE_KEY) {
    reasons.push(`source ${financialSource.sourceKey} (${financialSource.reason})`);
  }

  const txnKind = deriveTransactionKind({ isCredit, isTransfer, text: `${message.subject}\n${doc.text}`, templateKind });
  if (!referenceId) referenceId = extractReferenceId(doc.text);
  if (!txnTime) txnTime = extractClockTime(doc.text);

  // A self-transfer has no merchant; naming it after the descriptor text is noise.
  if (isTransfer && (merchant.normalized.includes('own account') || merchant.normalized.includes('transfer'))) {
    merchantRaw = 'Self transfer';
    merchant = { ...merchant, normalized: 'self transfer', display: 'Self transfer', matchedDictionary: false };
  }

  const resolution = categorize({
    normalizedMerchant: merchant.normalized,
    displayMerchant: merchant.display,
    bodyText: doc.text,
    isCredit,
    pack,
    lookup: deps.lookupMerchantRule,
  });

  let confidence = baseConfidence;
  if (!merchant.matchedDictionary) confidence *= 0.95;
  if (statementMarkers >= 1) confidence *= 0.9;
  confidence = Number(Math.max(0, Math.min(1, confidence)).toFixed(3));

  if (confidence < REJECT_THRESHOLD) {
    return reject(`confidence ${confidence} below threshold`, method);
  }

  const categoryKey = isTransfer ? 'transfers' : resolution.categoryKey;
  // Expenditure is money out: a debit or a card purchase. Credits, refunds and transfers are
  // recorded in history but never counted as spending.
  const excluded =
    deps.excludedCategories.has(categoryKey) || txnKind === 'credit' || txnKind === 'refund' || txnKind === 'transfer';

  const transaction: ParsedTransaction = {
    gmailMessageId: message.gmailMessageId,
    gmailThreadId: message.gmailThreadId ?? null,
    senderAddress: message.senderAddress,
    subject: message.subject,
    amountMinor,
    currencyCode: currency,
    isCredit,
    occurredAt,
    postedAt: message.headerDate,
    merchantRaw,
    merchantNormalized: merchant.normalized,
    merchantDisplay: merchant.display,
    accountLast4,
    // Prefer the identified product ("HDFC Pixel Play Credit Card") over the issuer.
    accountLabel: financialSource.sourceKey !== UNKNOWN_SOURCE_KEY ? financialSource.label : (sender?.issuer ?? null),
    sourceKey: financialSource.sourceKey,
    txnKind,
    referenceId,
    txnTime,
    counterpartyVpa,
    categoryKey,
    categorySource: isTransfer ? 'keyword' : resolution.source,
    isTransfer,
    isExcludedFromTotals: excluded,
    needsReview: confidence < REVIEW_THRESHOLD,
    confidence,
    confidenceReasons: reasons,
    extractionMethod: method,
    parserVersion: PARSER_VERSION,
    dedupeKey: computeDedupeKey({
      amountMinor,
      currencyCode: currency,
      occurredAt,
      merchantNormalized: merchant.normalized,
      isCredit,
      sourceKey: financialSource.sourceKey,
    }),
    senderKind: sender?.kind ?? 'unknown',
    source: message.source ?? 'gmail',
  };

  deps.logger?.debug('parsed transaction', {
    method,
    confidence,
    merchant: merchant.normalized,
    messageId: message.gmailMessageId,
  });

  return { status: 'parsed', transaction, debug };
}
