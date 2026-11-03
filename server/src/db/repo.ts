/**
 * Repositories. All SQL lives here; the rest of the app works with plain objects.
 *
 * node:sqlite only binds null | number | bigint | string | Uint8Array, so booleans become
 * 0/1 and dates become ISO strings at this boundary.
 */
import { randomUUID } from 'node:crypto';
import { getDb, withTransaction } from './index.js';
import { createLogger } from '../logger.js';
import type { CategoryDef, MerchantRuleRecord, ParsedTransaction, RulesPack } from '@expense/core';

const log = createLogger('db:repo');

const bool = (value: boolean): number => (value ? 1 : 0);
const iso = (value: Date): string => value.toISOString();
const nullable = <T>(value: T | null | undefined): T | null => (value === undefined ? null : value);

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
  /** Financial account/card: `hdfc_bank`, `hdfc_pixel_play`, `union_bank`, … */
  sourceKey: string;
  txnKind: 'debit' | 'credit' | 'refund' | 'transfer';
  referenceId: string | null;
  txnTime: string | null;
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

type RawTransaction = Record<string, unknown>;

function mapTransaction(row: RawTransaction): TransactionRow {
  let reasons: string[] = [];
  if (typeof row.confidence_reasons === 'string' && row.confidence_reasons !== '') {
    try {
      reasons = JSON.parse(row.confidence_reasons) as string[];
    } catch {
      reasons = [];
    }
  }
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    amountMinor: Number(row.amount_minor),
    currencyCode: String(row.currency_code),
    isCredit: Number(row.is_credit) === 1,
    occurredAt: String(row.occurred_at),
    postedAt: row.posted_at === null ? null : String(row.posted_at),
    merchantRaw: String(row.merchant_raw),
    merchantNormalized: String(row.merchant_normalized),
    merchantDisplay: String(row.merchant_display),
    accountLast4: row.account_last4 === null ? null : String(row.account_last4),
    accountLabel: row.account_label === null ? null : String(row.account_label),
    sourceKey: String(row.source_key ?? 'unknown'),
    txnKind: (row.txn_kind === null || row.txn_kind === undefined ? 'debit' : String(row.txn_kind)) as TransactionRow['txnKind'],
    referenceId: row.reference_id === null || row.reference_id === undefined ? null : String(row.reference_id),
    txnTime: row.txn_time === null || row.txn_time === undefined ? null : String(row.txn_time),
    counterpartyVpa: row.counterparty_vpa === null || row.counterparty_vpa === undefined ? null : String(row.counterparty_vpa),
    gmailMessageId: String(row.gmail_message_id),
    gmailThreadId: row.gmail_thread_id === null ? null : String(row.gmail_thread_id),
    senderAddress: String(row.sender_address),
    senderKind: String(row.sender_kind ?? 'unknown'),
    subject: row.subject === null ? null : String(row.subject),
    parserVersion: String(row.parser_version),
    extractionMethod: String(row.extraction_method),
    confidence: Number(row.confidence),
    confidenceReasons: reasons,
    categoryKey: row.category_key === null ? null : String(row.category_key),
    categorySource: row.category_source === null ? null : String(row.category_source),
    isUserConfirmed: Number(row.is_user_confirmed) === 1,
    isExcludedFromTotals: Number(row.is_excluded_from_totals) === 1,
    isTransfer: Number(row.is_transfer) === 1,
    needsReview: Number(row.needs_review) === 1,
    notes: row.notes === null ? null : String(row.notes),
    source: String(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.duplicate_count !== undefined ? { duplicateCount: Number(row.duplicate_count) } : {}),
  };
}

// ── Categories ────────────────────────────────────────────────────────────────

export function seedCategories(categories: CategoryDef[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO categories (key, name, color_hex, icon, sort_order, excluded_from_totals, is_system)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      color_hex = excluded.color_hex,
      icon = excluded.icon,
      sort_order = excluded.sort_order,
      excluded_from_totals = excluded.excluded_from_totals
  `);
  withTransaction(() => {
    for (const category of categories) {
      stmt.run(category.key, category.name, category.colorHex, category.icon, category.sortOrder, bool(category.excludedFromTotals));
    }
  });
}

export function listCategories(): CategoryRow[] {
  const rows = getDb().prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as RawTransaction[];
  return rows.map((row) => ({
    key: String(row.key),
    name: String(row.name),
    colorHex: String(row.color_hex),
    icon: String(row.icon),
    sortOrder: Number(row.sort_order),
    monthlyBudgetMinor: row.monthly_budget_minor === null ? null : Number(row.monthly_budget_minor),
    isSystem: Number(row.is_system) === 1,
    excludedFromTotals: Number(row.excluded_from_totals) === 1,
  }));
}

export function excludedCategoryKeys(): Set<string> {
  return new Set(listCategories().filter((c) => c.excludedFromTotals).map((c) => c.key));
}

// ── Merchant rules ────────────────────────────────────────────────────────────

export function seedMerchantRules(pack: RulesPack): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO merchant_rules (normalized_name, display_name, category_key, source, is_user_override, hit_count)
    VALUES (?, ?, ?, 'bundled', 0, 0)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name = excluded.display_name,
      category_key = CASE WHEN merchant_rules.is_user_override = 1 THEN merchant_rules.category_key ELSE excluded.category_key END
  `);
  let count = 0;
  withTransaction(() => {
    for (const [key, entry] of Object.entries(pack.merchants)) {
      stmt.run(key, entry.display, entry.category);
      count += 1;
    }
  });
  return count;
}

export function lookupMerchantRule(normalizedName: string): MerchantRuleRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM merchant_rules WHERE normalized_name = ?')
    .get(normalizedName) as RawTransaction | undefined;
  if (!row) return null;
  return {
    normalizedName: String(row.normalized_name),
    displayName: String(row.display_name),
    categoryKey: String(row.category_key),
    source: String(row.source),
    isUserOverride: Number(row.is_user_override) === 1,
  };
}

export function upsertMerchantRule(record: {
  normalizedName: string;
  displayName: string;
  categoryKey: string;
  source: string;
  isUserOverride: boolean;
}): void {
  getDb()
    .prepare(`
      INSERT INTO merchant_rules (normalized_name, display_name, category_key, source, is_user_override, last_used_at, hit_count)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
      ON CONFLICT(normalized_name) DO UPDATE SET
        display_name = excluded.display_name,
        category_key = excluded.category_key,
        source = excluded.source,
        is_user_override = excluded.is_user_override,
        last_used_at = datetime('now'),
        hit_count = merchant_rules.hit_count + 1
    `)
    .run(record.normalizedName, record.displayName, record.categoryKey, record.source, bool(record.isUserOverride));
}

export function countMerchantRules(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM merchant_rules').get() as { n: number };
  return Number(row.n);
}

// ── Transactions ──────────────────────────────────────────────────────────────

export function insertTransaction(tx: ParsedTransaction): string {
  const id = randomUUID();
  getDb()
    .prepare(`
      INSERT INTO transactions (
        id, dedupe_key, amount_minor, currency_code, is_credit, occurred_at, posted_at,
        merchant_raw, merchant_normalized, merchant_display, account_last4, account_label,
        source_key, txn_kind, reference_id, txn_time, counterparty_vpa,
        gmail_message_id, gmail_thread_id, sender_address, sender_kind, subject, parser_version,
        extraction_method, confidence, confidence_reasons, category_key, category_source,
        is_excluded_from_totals, is_transfer, needs_review, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      tx.dedupeKey,
      tx.amountMinor,
      tx.currencyCode,
      bool(tx.isCredit),
      iso(tx.occurredAt),
      tx.postedAt ? iso(tx.postedAt) : null,
      tx.merchantRaw,
      tx.merchantNormalized,
      tx.merchantDisplay,
      nullable(tx.accountLast4),
      nullable(tx.accountLabel),
      tx.sourceKey,
      tx.txnKind,
      nullable(tx.referenceId),
      nullable(tx.txnTime),
      nullable(tx.counterpartyVpa),
      tx.gmailMessageId,
      nullable(tx.gmailThreadId),
      tx.senderAddress,
      tx.senderKind,
      tx.subject,
      tx.parserVersion,
      tx.extractionMethod,
      tx.confidence,
      JSON.stringify(tx.confidenceReasons),
      tx.categoryKey,
      tx.categorySource,
      bool(tx.isExcludedFromTotals),
      bool(tx.isTransfer),
      bool(tx.needsReview),
      tx.source,
    );
  return id;
}

/** Candidate rows for the fuzzy dedupe pass: same amount and currency, nearby date. */
/** Candidate rows for the fuzzy dedupe pass: same amount, currency and source, nearby date. */
export function findDedupeCandidates(amountMinor: number, currencyCode: string, occurredAt: Date, source: string, windowDays = 3): TransactionRow[] {
  const from = new Date(occurredAt.getTime() - windowDays * 86_400_000).toISOString();
  const to = new Date(occurredAt.getTime() + windowDays * 86_400_000).toISOString();
  const rows = getDb()
    .prepare('SELECT * FROM transactions WHERE amount_minor = ? AND currency_code = ? AND source = ? AND occurred_at BETWEEN ? AND ?')
    .all(amountMinor, currencyCode, source, from, to) as RawTransaction[];
  return rows.map(mapTransaction);
}

export function findByDedupeKey(dedupeKey: string, source: string): TransactionRow | null {
  const row = getDb()
    .prepare('SELECT * FROM transactions WHERE dedupe_key = ? AND source = ? LIMIT 1')
    .get(dedupeKey, source) as RawTransaction | undefined;
  return row ? mapTransaction(row) : null;
}

export function findByMessageId(messageId: string): TransactionRow | null {
  const row = getDb().prepare('SELECT * FROM transactions WHERE gmail_message_id = ? LIMIT 1').get(messageId) as RawTransaction | undefined;
  return row ? mapTransaction(row) : null;
}

export function applyMergeUpdates(id: string, updates: Record<string, unknown>): void {
  const columnMap: Record<string, string> = {
    merchantRaw: 'merchant_raw',
    merchantNormalized: 'merchant_normalized',
    merchantDisplay: 'merchant_display',
    accountLast4: 'account_last4',
    accountLabel: 'account_label',
    occurredAt: 'occurred_at',
    confidence: 'confidence',
    extractionMethod: 'extraction_method',
  };
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(updates)) {
    const column = columnMap[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push(value instanceof Date ? value.toISOString() : (value as string | number | null));
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE transactions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
}

export function linkDuplicate(input: {
  primaryTransactionId: string;
  duplicateMessageId: string;
  duplicateSender: string;
  duplicateMerchant: string;
  similarity: number;
  matchKind: string;
}): void {
  getDb()
    .prepare(`
      INSERT INTO transaction_links (id, primary_transaction_id, duplicate_message_id, duplicate_sender, duplicate_merchant, similarity, match_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(duplicate_message_id) DO NOTHING
    `)
    .run(randomUUID(), input.primaryTransactionId, input.duplicateMessageId, input.duplicateSender, input.duplicateMerchant, input.similarity, input.matchKind);
}

export interface TransactionFilter {
  month?: string; // YYYY-MM
  categoryKey?: string;
  search?: string;
  needsReview?: boolean;
  includeExcluded?: boolean;
  limit?: number;
  offset?: number;
}

function buildWhere(filter: TransactionFilter): { clause: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filter.month) {
    conditions.push("strftime('%Y-%m', occurred_at) = ?");
    params.push(filter.month);
  }
  if (filter.categoryKey) {
    conditions.push('category_key = ?');
    params.push(filter.categoryKey);
  }
  if (filter.search) {
    conditions.push('(merchant_display LIKE ? OR merchant_raw LIKE ? OR subject LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  if (filter.needsReview) conditions.push('needs_review = 1');
  if (!filter.includeExcluded) conditions.push('is_excluded_from_totals = 0');
  return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export function listTransactions(filter: TransactionFilter = {}): { rows: TransactionRow[]; total: number } {
  const { clause, params } = buildWhere(filter);
  const limit = Math.min(filter.limit ?? 100, 500);
  const offset = filter.offset ?? 0;
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM transaction_links l WHERE l.primary_transaction_id = t.id) AS duplicate_count
      FROM transactions t ${clause}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as RawTransaction[];
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM transactions ${clause}`).get(...params) as { n: number };
  return { rows: rows.map(mapTransaction), total: Number(totalRow.n) };
}

export function getTransaction(id: string): TransactionRow | null {
  const row = getDb()
    .prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM transaction_links l WHERE l.primary_transaction_id = t.id) AS duplicate_count
      FROM transactions t WHERE t.id = ?
    `)
    .get(id) as RawTransaction | undefined;
  return row ? mapTransaction(row) : null;
}

export function listDuplicateLinks(transactionId: string): Array<{ duplicateMessageId: string; duplicateSender: string | null; duplicateMerchant: string | null; similarity: number; matchKind: string }> {
  const rows = getDb().prepare('SELECT * FROM transaction_links WHERE primary_transaction_id = ?').all(transactionId) as RawTransaction[];
  return rows.map((row) => ({
    duplicateMessageId: String(row.duplicate_message_id),
    duplicateSender: row.duplicate_sender === null ? null : String(row.duplicate_sender),
    duplicateMerchant: row.duplicate_merchant === null ? null : String(row.duplicate_merchant),
    similarity: Number(row.similarity),
    matchKind: String(row.match_kind),
  }));
}

export function updateTransactionFields(
  id: string,
  fields: { categoryKey?: string; notes?: string | null; isExcludedFromTotals?: boolean; isUserConfirmed?: boolean; needsReview?: boolean },
): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (fields.categoryKey !== undefined) {
    sets.push('category_key = ?', "category_source = 'user'");
    values.push(fields.categoryKey);
  }
  if (fields.notes !== undefined) {
    sets.push('notes = ?');
    values.push(fields.notes);
  }
  if (fields.isExcludedFromTotals !== undefined) {
    sets.push('is_excluded_from_totals = ?');
    values.push(bool(fields.isExcludedFromTotals));
  }
  if (fields.isUserConfirmed !== undefined) {
    sets.push('is_user_confirmed = ?');
    values.push(bool(fields.isUserConfirmed));
  }
  if (fields.needsReview !== undefined) {
    sets.push('needs_review = ?');
    values.push(bool(fields.needsReview));
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE transactions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
}

/**
 * §4: "always apply it retroactively to all past transactions from that merchant."
 * Returns the number of *other* rows changed so the UI can offer an undo toast.
 */
export function recategorizeMerchant(
  merchantNormalized: string,
  categoryKey: string,
  excludeId: string,
  excluded: Set<string>,
): { affected: number; previous: Array<{ id: string; categoryKey: string | null; isExcludedFromTotals: boolean }> } {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, category_key, is_excluded_from_totals FROM transactions WHERE merchant_normalized = ? AND id != ?')
    .all(merchantNormalized, excludeId) as RawTransaction[];

  const previous = rows.map((row) => ({
    id: String(row.id),
    categoryKey: row.category_key === null ? null : String(row.category_key),
    isExcludedFromTotals: Number(row.is_excluded_from_totals) === 1,
  }));

  db.prepare(`
    UPDATE transactions
    SET category_key = ?, category_source = 'user', is_excluded_from_totals = ?, updated_at = datetime('now')
    WHERE merchant_normalized = ?
  `).run(categoryKey, bool(excluded.has(categoryKey)), merchantNormalized);

  return { affected: previous.length, previous };
}

export function restoreCategories(
  entries: Array<{ id: string; categoryKey: string | null; isExcludedFromTotals: boolean }>,
): void {
  const stmt = getDb().prepare(
    "UPDATE transactions SET category_key = ?, is_excluded_from_totals = ?, category_source = 'restored', updated_at = datetime('now') WHERE id = ?",
  );
  withTransaction(() => {
    for (const entry of entries) stmt.run(entry.categoryKey, bool(entry.isExcludedFromTotals), entry.id);
  });
}

export function deleteTransaction(id: string): boolean {
  const result = getDb().prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function deleteBySource(source: string): number {
  const result = getDb().prepare('DELETE FROM transactions WHERE source = ?').run(source);
  return Number(result.changes);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface MonthlyStats {
  month: string;
  currency: string;
  totalSpentMinor: number;
  totalIncomeMinor: number;
  transactionCount: number;
  excludedCount: number;
  needsReviewCount: number;
  byCategory: Array<{ categoryKey: string; name: string; colorHex: string; totalMinor: number; count: number; share: number }>;
  byDay: Array<{ day: string; totalMinor: number }>;
  topMerchants: Array<{ merchant: string; normalized: string; totalMinor: number; count: number }>;
}

export function monthlyStats(month: string, currency: string): MonthlyStats {
  const db = getDb();
  // §6: refunds subtract. A credit that is not an income/transfer row reduces spend in the
  // Expenditure is money out only. Credits, refunds and transfers are excluded from the
  // month's spending (they stay in history), and a refund is never reported as income.
  const spend = db
    .prepare(`
      SELECT COALESCE(SUM(CASE WHEN is_credit = 1 THEN -amount_minor ELSE amount_minor END), 0) AS total,
             COUNT(*) AS n
      FROM transactions
      WHERE strftime('%Y-%m', occurred_at) = ? AND currency_code = ? AND is_excluded_from_totals = 0
    `)
    .get(month, currency) as { total: number; n: number };

  const income = db
    .prepare(`
      SELECT COALESCE(SUM(amount_minor), 0) AS total
      FROM transactions
      WHERE strftime('%Y-%m', occurred_at) = ? AND currency_code = ? AND is_credit = 1
        AND txn_kind <> 'refund' AND is_excluded_from_totals = 1
    `)
    .get(month, currency) as { total: number };

  const excluded = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE strftime('%Y-%m', occurred_at) = ? AND is_excluded_from_totals = 1")
    .get(month) as { n: number };

  const review = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE strftime('%Y-%m', occurred_at) = ? AND needs_review = 1")
    .get(month) as { n: number };

  const categories = db
    .prepare(`
      SELECT t.category_key AS key, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.color_hex, '#7A7A7A') AS color,
             SUM(CASE WHEN t.is_credit = 1 THEN -t.amount_minor ELSE t.amount_minor END) AS total,
             COUNT(*) AS n
      FROM transactions t
      LEFT JOIN categories c ON c.key = t.category_key
      WHERE strftime('%Y-%m', t.occurred_at) = ? AND t.currency_code = ? AND t.is_excluded_from_totals = 0
      GROUP BY t.category_key
      ORDER BY total DESC
    `)
    .all(month, currency) as RawTransaction[];

  const byDay = db
    .prepare(`
      SELECT substr(occurred_at, 1, 10) AS day,
             SUM(CASE WHEN is_credit = 1 THEN -amount_minor ELSE amount_minor END) AS total
      FROM transactions
      WHERE strftime('%Y-%m', occurred_at) = ? AND currency_code = ? AND is_excluded_from_totals = 0
      GROUP BY day ORDER BY day
    `)
    .all(month, currency) as RawTransaction[];

  const merchants = db
    .prepare(`
      SELECT merchant_display AS merchant, merchant_normalized AS normalized,
             SUM(CASE WHEN is_credit = 1 THEN -amount_minor ELSE amount_minor END) AS total,
             COUNT(*) AS n
      FROM transactions
      WHERE strftime('%Y-%m', occurred_at) = ? AND currency_code = ? AND is_excluded_from_totals = 0
      GROUP BY merchant_normalized ORDER BY total DESC LIMIT 8
    `)
    .all(month, currency) as RawTransaction[];

  const total = Number(spend.total);
  return {
    month,
    currency,
    totalSpentMinor: total,
    totalIncomeMinor: Number(income.total),
    transactionCount: Number(spend.n),
    excludedCount: Number(excluded.n),
    needsReviewCount: Number(review.n),
    byCategory: categories.map((row) => ({
      categoryKey: row.key === null ? 'uncategorized' : String(row.key),
      name: String(row.name),
      colorHex: String(row.color),
      totalMinor: Number(row.total),
      count: Number(row.n),
      share: total > 0 ? Number((Number(row.total) / total).toFixed(4)) : 0,
    })),
    byDay: byDay.map((row) => ({ day: String(row.day), totalMinor: Number(row.total) })),
    topMerchants: merchants.map((row) => ({
      merchant: String(row.merchant),
      normalized: String(row.normalized),
      totalMinor: Number(row.total),
      count: Number(row.n),
    })),
  };
}

export function availableMonths(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT strftime('%Y-%m', occurred_at) AS m FROM transactions ORDER BY m DESC")
    .all() as Array<{ m: string }>;
  return rows.map((r) => String(r.m));
}

export function distinctCurrencies(): string[] {
  const rows = getDb()
    .prepare('SELECT currency_code AS c, COUNT(*) AS n FROM transactions GROUP BY currency_code ORDER BY n DESC')
    .all() as Array<{ c: string }>;
  return rows.map((r) => String(r.c));
}

// ── Telemetry, triage, discovery ──────────────────────────────────────────────

export function recordParseFailure(input: { senderDomain: string; subjectShape: string; stageReached: string; reason: string }): void {
  getDb()
    .prepare('INSERT INTO parse_failures (id, sender_domain, subject_shape, stage_reached, reason) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), input.senderDomain, input.subjectShape, input.stageReached, input.reason);
}

export function parseFailureSummary(limit = 20): Array<{ senderDomain: string; count: number; lastStage: string; lastSeen: string }> {
  const rows = getDb()
    .prepare(`
      SELECT sender_domain, COUNT(*) AS n, MAX(occurred_at) AS last_seen,
             (SELECT stage_reached FROM parse_failures f2 WHERE f2.sender_domain = f1.sender_domain ORDER BY occurred_at DESC LIMIT 1) AS last_stage
      FROM parse_failures f1 GROUP BY sender_domain ORDER BY n DESC LIMIT ?
    `)
    .all(limit) as RawTransaction[];
  return rows.map((row) => ({
    senderDomain: String(row.sender_domain),
    count: Number(row.n),
    lastStage: String(row.last_stage ?? ''),
    lastSeen: String(row.last_seen ?? ''),
  }));
}

export function markTriaged(messageId: string, senderDomain: string, decision: string, parserVersion: string): void {
  getDb()
    .prepare(`
      INSERT INTO message_triage (gmail_message_id, sender_domain, decision, parser_version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(gmail_message_id) DO UPDATE SET decision = excluded.decision, parser_version = excluded.parser_version, seen_at = datetime('now')
    `)
    .run(messageId, senderDomain, decision, parserVersion);
}

export function seenMessageIds(ids: string[], parserVersion: string): Set<string> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT gmail_message_id FROM message_triage WHERE parser_version = ? AND gmail_message_id IN (${placeholders})`)
    .all(parserVersion, ...ids) as Array<{ gmail_message_id: string }>;
  return new Set(rows.map((r) => String(r.gmail_message_id)));
}

export function recordDiscoveredSender(address: string, domain: string, success: boolean): void {
  getDb()
    .prepare(`
      INSERT INTO discovered_senders (sender_address, sender_domain, success_count, failure_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sender_address) DO UPDATE SET
        success_count = discovered_senders.success_count + ?,
        failure_count = discovered_senders.failure_count + ?,
        last_seen_at = datetime('now')
    `)
    .run(address, domain, success ? 1 : 0, success ? 0 : 1, success ? 1 : 0, success ? 0 : 1);
}

export function promotedSenders(minSuccesses = 2): string[] {
  const rows = getDb()
    .prepare('SELECT sender_address FROM discovered_senders WHERE success_count >= ? ORDER BY success_count DESC LIMIT 60')
    .all(minSuccesses) as Array<{ sender_address: string }>;
  return rows.map((r) => String(r.sender_address));
}

export function listDiscoveredSenders(): Array<{ address: string; domain: string; success: number; failure: number }> {
  const rows = getDb().prepare('SELECT * FROM discovered_senders ORDER BY success_count DESC, failure_count DESC LIMIT 100').all() as RawTransaction[];
  return rows.map((row) => ({
    address: String(row.sender_address),
    domain: String(row.sender_domain),
    success: Number(row.success_count),
    failure: Number(row.failure_count),
  }));
}

// ── Sync state and runs ───────────────────────────────────────────────────────

export interface SyncStateRow {
  accountEmail: string;
  lastHistoryId: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastDiscoverySweepAt: string | null;
  backfillCompletedThrough: string | null;
  rulesPackVersion: string | null;
}

export function getSyncState(accountEmail: string): SyncStateRow | null {
  const row = getDb().prepare('SELECT * FROM sync_state WHERE account_email = ?').get(accountEmail) as RawTransaction | undefined;
  if (!row) return null;
  return {
    accountEmail: String(row.account_email),
    lastHistoryId: row.last_history_id === null ? null : String(row.last_history_id),
    lastFullSyncAt: row.last_full_sync_at === null ? null : String(row.last_full_sync_at),
    lastIncrementalSyncAt: row.last_incremental_sync_at === null ? null : String(row.last_incremental_sync_at),
    lastDiscoverySweepAt: row.last_discovery_sweep_at === null ? null : String(row.last_discovery_sweep_at),
    backfillCompletedThrough: row.backfill_completed_through === null ? null : String(row.backfill_completed_through),
    rulesPackVersion: row.rules_pack_version === null ? null : String(row.rules_pack_version),
  };
}

export function upsertSyncState(accountEmail: string, patch: Partial<Omit<SyncStateRow, 'accountEmail'>>): void {
  const db = getDb();
  db.prepare('INSERT INTO sync_state (account_email) VALUES (?) ON CONFLICT(account_email) DO NOTHING').run(accountEmail);
  const columnMap: Record<string, string> = {
    lastHistoryId: 'last_history_id',
    lastFullSyncAt: 'last_full_sync_at',
    lastIncrementalSyncAt: 'last_incremental_sync_at',
    lastDiscoverySweepAt: 'last_discovery_sweep_at',
    backfillCompletedThrough: 'backfill_completed_through',
    rulesPackVersion: 'rules_pack_version',
  };
  const sets: string[] = [];
  const values: Array<string | null> = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columnMap[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push((value as string | null) ?? null);
  }
  if (sets.length === 0) return;
  values.push(accountEmail);
  db.prepare(`UPDATE sync_state SET ${sets.join(', ')} WHERE account_email = ?`).run(...values);
}

export interface SyncRunRow {
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
  pageToken: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export function createSyncRun(kind: string): string {
  const id = randomUUID();
  getDb().prepare("INSERT INTO sync_runs (id, kind, status, phase) VALUES (?, ?, 'running', 'starting')").run(id, kind);
  return id;
}

export function updateSyncRun(id: string, patch: Partial<Omit<SyncRunRow, 'id' | 'kind' | 'startedAt'>>): void {
  const columnMap: Record<string, string> = {
    status: 'status',
    phase: 'phase',
    finishedAt: 'finished_at',
    listed: 'listed',
    fetched: 'fetched',
    parsed: 'parsed',
    created: 'created',
    duplicates: 'duplicates',
    skipped: 'skipped',
    failed: 'failed',
    pageToken: 'page_token',
    errorCode: 'error_code',
    errorMessage: 'error_message',
  };
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columnMap[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push((value as string | number | null) ?? null);
  }
  if (sets.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE sync_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function mapSyncRun(row: RawTransaction): SyncRunRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    phase: row.phase === null ? null : String(row.phase),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at === null ? null : String(row.finished_at),
    listed: Number(row.listed),
    fetched: Number(row.fetched),
    parsed: Number(row.parsed),
    created: Number(row.created),
    duplicates: Number(row.duplicates),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    pageToken: row.page_token === null ? null : String(row.page_token),
    errorCode: row.error_code === null ? null : String(row.error_code),
    errorMessage: row.error_message === null ? null : String(row.error_message),
  };
}

export function latestSyncRun(): SyncRunRow | null {
  const row = getDb().prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1').get() as RawTransaction | undefined;
  return row ? mapSyncRun(row) : null;
}

export function listSyncRuns(limit = 10): SyncRunRow[] {
  const rows = getDb().prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?').all(limit) as RawTransaction[];
  return rows.map(mapSyncRun);
}

export function markStaleRunsFailed(): number {
  const result = getDb()
    .prepare("UPDATE sync_runs SET status = 'failed', error_code = 'interrupted', error_message = 'Server restarted during sync', finished_at = datetime('now') WHERE status = 'running'")
    .run();
  const changed = Number(result.changes);
  if (changed > 0) log.warn('marked interrupted sync runs as failed', { count: changed });
  return changed;
}

// ── Token vault and settings ──────────────────────────────────────────────────

export interface TokenRow {
  accountEmail: string;
  refreshTokenEnc: string | null;
  accessTokenEnc: string | null;
  accessTokenExpiresAt: string | null;
  scope: string | null;
}

export function saveTokens(row: TokenRow): void {
  getDb()
    .prepare(`
      INSERT INTO oauth_tokens (id, account_email, refresh_token_enc, access_token_enc, access_token_expires_at, scope)
      VALUES ('primary', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_email = excluded.account_email,
        refresh_token_enc = COALESCE(excluded.refresh_token_enc, oauth_tokens.refresh_token_enc),
        access_token_enc = excluded.access_token_enc,
        access_token_expires_at = excluded.access_token_expires_at,
        scope = COALESCE(excluded.scope, oauth_tokens.scope),
        updated_at = datetime('now')
    `)
    .run(row.accountEmail, row.refreshTokenEnc, row.accessTokenEnc, row.accessTokenExpiresAt, row.scope);
}

export function loadTokens(): TokenRow | null {
  const row = getDb().prepare("SELECT * FROM oauth_tokens WHERE id = 'primary'").get() as RawTransaction | undefined;
  if (!row) return null;
  return {
    accountEmail: String(row.account_email),
    refreshTokenEnc: row.refresh_token_enc === null ? null : String(row.refresh_token_enc),
    accessTokenEnc: row.access_token_enc === null ? null : String(row.access_token_enc),
    accessTokenExpiresAt: row.access_token_expires_at === null ? null : String(row.access_token_expires_at),
    scope: row.scope === null ? null : String(row.scope),
  };
}

export function clearTokens(): void {
  getDb().prepare('DELETE FROM oauth_tokens').run();
}

export function savePendingAuth(state: string, codeVerifier: string): void {
  const db = getDb();
  db.prepare("DELETE FROM oauth_pending WHERE created_at < datetime('now', '-15 minutes')").run();
  db.prepare('INSERT INTO oauth_pending (state, code_verifier) VALUES (?, ?)').run(state, codeVerifier);
}

export function takePendingAuth(state: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT code_verifier FROM oauth_pending WHERE state = ?').get(state) as { code_verifier: string } | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM oauth_pending WHERE state = ?').run(state);
  return String(row.code_verifier);
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? String(row.value) : null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')")
    .run(key, value);
}
