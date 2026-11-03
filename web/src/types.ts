export interface Transaction {
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

export interface Category {
  key: string;
  name: string;
  colorHex: string;
  icon: string;
  sortOrder: number;
  monthlyBudgetMinor: number | null;
  isSystem: boolean;
  excludedFromTotals: boolean;
}

export interface CategoryStat {
  categoryKey: string;
  name: string;
  colorHex: string;
  totalMinor: number;
  count: number;
  share: number;
}

export interface Summary {
  month: string;
  currency: string;
  totalSpentMinor: number;
  totalIncomeMinor: number;
  transactionCount: number;
  excludedCount: number;
  needsReviewCount: number;
  byCategory: CategoryStat[];
  byDay: Array<{ day: string; totalMinor: number }>;
  topMerchants: Array<{ merchant: string; normalized: string; totalMinor: number; count: number }>;
  availableMonths: string[];
  availableCurrencies: string[];
  previousMonth: { month: string; totalSpentMinor: number; transactionCount: number };
  changeVsPreviousMinor: number;
}

export interface SyncRun {
  id: string;
  kind: string;
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
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SyncStatus {
  running: boolean;
  connection: {
    connected: boolean;
    configured: boolean;
    accountEmail: string | null;
    scope: string | null;
    accessTokenExpiresAt: string | null;
    tokenKeyIsEphemeral: boolean;
  };
  state: {
    lastHistoryId: string | null;
    lastFullSyncAt: string | null;
    lastIncrementalSyncAt: string | null;
    backfillCompletedThrough: string | null;
  } | null;
  latestRun: SyncRun | null;
  recentRuns: SyncRun[];
  rulesPackVersion: string;
  parserVersion: string;
  remoteLlmEnabled: boolean;
  windowDays: number;
  schedulerMinutes: number;
}

export interface DuplicateLink {
  duplicateMessageId: string;
  duplicateSender: string | null;
  duplicateMerchant: string | null;
  similarity: number;
  matchKind: string;
}

export interface ParseTrace {
  input: { from: string; senderAddress?: string; subject: string; headerDate: string; matchedSender?: string | null };
  result:
    | {
        status: 'parsed';
        transaction: Transaction;
        debug: ParseDebug;
      }
    | { status: 'rejected'; reason: string; stageReached: string; subjectShape: string; senderDomain: string; debug: ParseDebug };
  parserVersion?: string;
  rulesPackVersion?: string;
}

export interface ParseDebug {
  senderRuleId: string | null;
  senderKind: string | null;
  stages: string[];
  textLength: number;
  dateSource?: string;
  templateId?: string;
  cleanedText?: string;
  amountCandidates: Array<{ raw: string; minorUnits: number; currency: string; score: number; reasons: string[] }>;
}

export interface FixtureSummary {
  id: string;
  from: string;
  subject: string;
  daysAgo: number;
  hasHtml: boolean;
  expected: { status: string };
}
