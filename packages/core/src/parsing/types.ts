/** Shapes shared between the Gmail client, the parsing pipeline and storage. */

export interface EmailMessage {
  gmailMessageId: string;
  gmailThreadId?: string;
  /** Raw From header, e.g. `HDFC Bank Alerts <alerts@hdfcbank.net>`. */
  from: string;
  senderAddress: string;
  subject: string;
  /** The email Date header — the *send* time, not necessarily the transaction time. */
  headerDate: Date;
  textBody?: string;
  htmlBody?: string;
  snippet?: string;
  /** 'gmail' for live mail, 'sample' for the bundled fixtures. */
  source?: string;
}

export type ExtractionMethod = 'template' | 'jsonld' | 'regex' | 'llm-remote';

/**
 * What the money did. `debit` is spending; `credit` is money in (salary, interest); `refund`
 * is money back from a merchant; `transfer` is movement between the person's own accounts.
 * Only `debit` counts as expenditure — refunds subtract from it (§6).
 */
export type TransactionKind = 'debit' | 'purchase' | 'credit' | 'refund' | 'transfer';

export interface ParsedTransaction {
  gmailMessageId: string;
  gmailThreadId: string | null;
  senderAddress: string;
  subject: string;
  amountMinor: number;
  currencyCode: string;
  isCredit: boolean;
  occurredAt: Date;
  postedAt: Date | null;
  merchantRaw: string;
  merchantNormalized: string;
  merchantDisplay: string;
  accountLast4: string | null;
  accountLabel: string | null;
  /** Which financial account or card this belongs to, e.g. `hdfc_pixel_play`. */
  sourceKey: string;
  txnKind: TransactionKind;
  /** Bank/UPI reference (UPI Ref no, UTR, transaction id) when the email carries one. */
  referenceId: string | null;
  /** Wall-clock time exactly as the email printed it (`HH:MM`), when it printed one. */
  txnTime: string | null;
  /** UPI address the money went to, kept beside the payee's readable name. */
  counterpartyVpa: string | null;
  categoryKey: string;
  categorySource: string;
  isTransfer: boolean;
  isExcludedFromTotals: boolean;
  needsReview: boolean;
  confidence: number;
  confidenceReasons: string[];
  extractionMethod: ExtractionMethod;
  parserVersion: string;
  dedupeKey: string;
  senderKind: string;
  source: string;
}

export interface ParseDebug {
  senderRuleId: string | null;
  senderKind: string | null;
  /** Identified financial source and the evidence that chose it. */
  financialSource?: string;
  financialSourceReason?: string;
  stages: string[];
  textLength: number;
  amountCandidates: Array<{ raw: string; minorUnits: number; currency: string; score: number; reasons: string[] }>;
  dateSource?: string;
  templateId?: string;
  /** Plain text the pipeline actually worked on — the debug screen the spec asks for on day one. */
  cleanedText?: string;
}

export type ParseResult =
  | { status: 'parsed'; transaction: ParsedTransaction; debug: ParseDebug }
  | { status: 'rejected'; reason: string; stageReached: string; subjectShape: string; senderDomain: string; debug: ParseDebug };
