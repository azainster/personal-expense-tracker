/** Row shapes shared by the SQL store, the sync engine, the API and the app UI. */
import type { TransactionKind } from '../parsing/types.js';

export interface CategoryRow {
  key: string;
  name: string;
  colorHex: string;
  icon: string;
  sortOrder: number;
  monthlyBudgetMinor: number | null;
  isSystem: boolean;
  excludedFromTotals: boolean;
}

export interface TransactionRow {
  id: string;
  dedupeKey: string;
  amountMinor: number;
  currencyCode: string;
  isCredit: boolean;
  occurredAt: string;
  postedAt: string | null;
  merchantRaw: string;
  merchantNormalized: string;
  merchantDisplay: string;
  accountLast4: string | null;
  accountLabel: string | null;
  /** Financial account/card this belongs to: `hdfc_bank`, `hdfc_pixel_play`, `union_bank`, … */
  sourceKey: string;
  txnKind: TransactionKind;
  referenceId: string | null;
  txnTime: string | null;
  /** UPI address the money went to, when the email named one. */
  counterpartyVpa: string | null;
  gmailMessageId: string;
  gmailThreadId: string | null;
  senderAddress: string;
  senderKind: string;
  subject: string | null;
  parserVersion: string;
  extractionMethod: string;
  confidence: number;
  confidenceReasons: string[];
  categoryKey: string | null;
  categorySource: string | null;
  isUserConfirmed: boolean;
  isExcludedFromTotals: boolean;
  isTransfer: boolean;
  needsReview: boolean;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  duplicateCount?: number;
}

export interface DuplicateLinkRow {
  duplicateMessageId: string;
  duplicateSender: string | null;
  duplicateMerchant: string | null;
  similarity: number;
  matchKind: string;
  mergedAt?: string;
}

export interface TransactionFilter {
  /** YYYY-MM, in the store's local time offset. */
  month?: string;
  categoryKey?: string;
  /** One financial account/card; omit for every account. */
  sourceKey?: string;
  search?: string;
  needsReview?: boolean;
  includeExcluded?: boolean;
  limit?: number;
  offset?: number;
}

/** Spending for one financial account/card. Labels live in the rules pack, not the database. */
export interface SourceStat {
  sourceKey: string;
  totalMinor: number;
  count: number;
  share: number;
}

export interface CategoryStat {
  categoryKey: string;
  name: string;
  colorHex: string;
  icon: string;
  totalMinor: number;
  count: number;
  share: number;
}

export interface MonthlyStats {
  month: string;
  currency: string;
  totalSpentMinor: number;
  totalIncomeMinor: number;
  transactionCount: number;
  excludedCount: number;
  needsReviewCount: number;
  /** Always every account, even when the rest of the stats are filtered to one. */
  bySource: SourceStat[];
  /** The account the other figures are scoped to, or null for all accounts. */
  sourceKey: string | null;
  byCategory: CategoryStat[];
  byDay: Array<{ day: string; totalMinor: number }>;
  topMerchants: Array<{ merchant: string; normalized: string; totalMinor: number; count: number }>;
}

export interface MonthlySummary extends MonthlyStats {
  availableMonths: string[];
  availableCurrencies: string[];
  previousMonth: { month: string; totalSpentMinor: number; transactionCount: number };
  changeVsPreviousMinor: number;
}

export interface SyncStateRow {
  accountEmail: string;
  lastHistoryId: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastDiscoverySweepAt: string | null;
  backfillCompletedThrough: string | null;
  rulesPackVersion: string | null;
}

export interface SyncRunRow {
  id: string;
  kind: string;
  /** running | completed | partial | failed */
  status: string;
  phase: string | null;
  startedAt: string;
  finishedAt: string | null;
  listed: number;
  fetched: number;
  parsed: number;
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
  pageToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ParseFailureSummaryRow {
  senderDomain: string;
  count: number;
  lastStage: string;
  lastSeen: string;
}

export interface DiscoveredSenderRow {
  address: string;
  domain: string;
  success: number;
  failure: number;
}
