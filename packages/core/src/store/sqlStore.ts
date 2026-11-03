/**
 * On-device store. All SQL for the app lives here; the UI works with plain objects.
 *
 * Booleans become 0/1 and dates become ISO-8601 UTC strings at this boundary. Month and day
 * grouping is done in the user's local time via a `±N minutes` modifier, so a purchase at
 * 00:30 on the 1st in IST lands in the month the user actually made it in.
 */
import { NotFoundError, ValidationError } from '../errors.js';
import type { MerchantRuleRecord } from '../parsing/categorize.js';
import { MERCHANT_FROM_SENDER_REASON } from '../parsing/pipeline.js';
import type { CategoryDef, RulesPack } from '../parsing/rulespack.js';
import type { ParsedTransaction } from '../parsing/types.js';
import type { DuplicateLinkInput, ParseFailureInput, SyncRunPatch, SyncStore } from '../sync/store.js';
import type { SqlDriver, SqlValue } from './driver.js';
import { DATA_TABLES, runStoreMigrations } from './migrations.js';
import type {
  CategoryRow,
  DiscoveredSenderRow,
  DuplicateLinkRow,
  MonthlyStats,
  MonthlySummary,
  ParseFailureSummaryRow,
  SyncRunRow,
  SyncStateRow,
  TransactionFilter,
  TransactionRow,
} from './types.js';

type Raw = Record<string, unknown>;

const bool = (value: boolean): number => (value ? 1 : 0);
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

export interface SqlStoreOptions {
  /** UUID generator (expo-crypto on the phone, node:crypto in tests). */
  newId: () => string;
  /** Minutes east of UTC used for month/day grouping. Defaults to 0 (UTC). */
  utcOffsetMinutes?: number | (() => number);
}

export interface RecategorizeUndo {
  transactionId: string;
  merchantNormalized: string;
  rows: Array<{ id: string; categoryKey: string | null; categorySource: string | null; isExcludedFromTotals: boolean; isUserConfirmed: boolean; needsReview: boolean }>;
  previousRule: MerchantRuleRecord | null;
  ruleTouched: boolean;
}

export interface RecategorizeResult {
  transaction: TransactionRow;
  /** Other transactions from the same merchant that were changed. */
  retroactivelyUpdated: number;
  /**
   * `merchant` — remembered for the merchant and applied to its other transactions.
   * `transaction` — this row only, because its "merchant" is just the sender's name.
   */
  scope: 'merchant' | 'transaction';
  undo: RecategorizeUndo;
}

function mapTransaction(row: Raw): TransactionRow {
  // I keep the SQL-to-domain conversion in one place so the UI never has to know about column names.
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
    postedAt: str(row.posted_at),
    merchantRaw: String(row.merchant_raw),
    merchantNormalized: String(row.merchant_normalized),
    merchantDisplay: String(row.merchant_display),
    accountLast4: str(row.account_last4),
    accountLabel: str(row.account_label),
    sourceKey: String(row.source_key ?? 'unknown'),
    txnKind: (str(row.txn_kind) ?? 'debit') as TransactionRow['txnKind'],
    referenceId: str(row.reference_id),
    txnTime: str(row.txn_time),
    counterpartyVpa: str(row.counterparty_vpa),
    gmailMessageId: String(row.gmail_message_id),
    gmailThreadId: str(row.gmail_thread_id),
    senderAddress: String(row.sender_address),
    senderKind: String(row.sender_kind ?? 'unknown'),
    subject: str(row.subject),
    parserVersion: String(row.parser_version),
    extractionMethod: String(row.extraction_method),
    confidence: Number(row.confidence),
    confidenceReasons: reasons,
    categoryKey: str(row.category_key),
    categorySource: str(row.category_source),
    isUserConfirmed: Number(row.is_user_confirmed) === 1,
    isExcludedFromTotals: Number(row.is_excluded_from_totals) === 1,
    isTransfer: Number(row.is_transfer) === 1,
    needsReview: Number(row.needs_review) === 1,
    notes: str(row.notes),
    source: String(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.duplicate_count !== undefined ? { duplicateCount: Number(row.duplicate_count) } : {}),
  };
}

function mapRule(row: Raw): MerchantRuleRecord {
  return {
    normalizedName: String(row.normalized_name),
    displayName: String(row.display_name),
    categoryKey: String(row.category_key),
    source: String(row.source),
    isUserOverride: Number(row.is_user_override) === 1,
  };
}

function mapSyncRun(row: Raw): SyncRunRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    phase: str(row.phase),
    startedAt: String(row.started_at),
    finishedAt: str(row.finished_at),
    listed: Number(row.listed),
    fetched: Number(row.fetched),
    parsed: Number(row.parsed),
    created: Number(row.created),
    duplicates: Number(row.duplicates),
    skipped: Number(row.skipped),
    failed: Number(row.failed),
    pageToken: str(row.page_token),
    errorCode: str(row.error_code),
    errorMessage: str(row.error_message),
  };
}

export function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

const SIGNED_AMOUNT = 'CASE WHEN is_credit = 1 THEN -amount_minor ELSE amount_minor END';

export class SqlStore implements SyncStore {
  private ruleCache: Map<string, MerchantRuleRecord> | null = null;
  private readonly newId: () => string;
  private readonly offset: () => number;

  constructor(readonly db: SqlDriver, options: SqlStoreOptions) {
    this.newId = options.newId;
    const configured = options.utcOffsetMinutes ?? 0;
    this.offset = typeof configured === 'function' ? configured : () => configured;
  }

  /** SQLite date modifier for the local offset, e.g. `+330 minutes`. */
  private tz(): string {
    const minutes = Math.round(this.offset());
    return `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`;
  }

  /** The current month in the store's local offset. */
  currentMonth(now = Date.now()): string {
    return new Date(now + this.offset() * 60_000).toISOString().slice(0, 7);
  }

  async migrate(): Promise<void> {
    await this.db.exec('PRAGMA foreign_keys = ON');
    await runStoreMigrations(this.db);
  }

  // ── Categories ──────────────────────────────────────────────────────────────

  async seedCategories(categories: CategoryDef[]): Promise<void> {
    await this.db.transaction(async () => {
      for (const c of categories) {
        await this.db.run(
          `INSERT INTO categories (key, name, color_hex, icon, sort_order, excluded_from_totals, is_system)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT(key) DO UPDATE SET
             name = excluded.name, color_hex = excluded.color_hex, icon = excluded.icon,
             sort_order = excluded.sort_order, excluded_from_totals = excluded.excluded_from_totals`,
          [c.key, c.name, c.colorHex, c.icon, c.sortOrder, bool(c.excludedFromTotals)],
        );
      }
    });
  }

  async listCategories(): Promise<CategoryRow[]> {
    const rows = await this.db.all('SELECT * FROM categories ORDER BY sort_order, name');
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

  async excludedCategoryKeys(): Promise<Set<string>> {
    return new Set((await this.listCategories()).filter((c) => c.excludedFromTotals).map((c) => c.key));
  }

  // ── Merchant rules ──────────────────────────────────────────────────────────

  /** Seeds the bundled dictionary. User overrides are never replaced by a rules-pack update. */
  async seedMerchantRules(pack: RulesPack): Promise<number> {
    let count = 0;
    await this.db.transaction(async () => {
      for (const [key, entry] of Object.entries(pack.merchants)) {
        await this.db.run(
          `INSERT INTO merchant_rules (normalized_name, display_name, category_key, source, is_user_override, hit_count)
           VALUES (?, ?, ?, 'bundled', 0, 0)
           ON CONFLICT(normalized_name) DO UPDATE SET
             display_name = CASE WHEN merchant_rules.is_user_override = 1 THEN merchant_rules.display_name ELSE excluded.display_name END,
             category_key = CASE WHEN merchant_rules.is_user_override = 1 THEN merchant_rules.category_key ELSE excluded.category_key END`,
          [key, entry.display, entry.category],
        );
        count += 1;
      }
    });
    this.ruleCache = null;
    return count;
  }

  private async loadRuleCache(): Promise<Map<string, MerchantRuleRecord>> {
    if (!this.ruleCache) {
      const rows = await this.db.all('SELECT * FROM merchant_rules');
      this.ruleCache = new Map(rows.map((row) => [String(row.normalized_name), mapRule(row)]));
    }
    return this.ruleCache;
  }

  async merchantRuleLookup(): Promise<(normalizedName: string) => MerchantRuleRecord | null> {
    const cache = await this.loadRuleCache();
    return (name) => cache.get(name) ?? null;
  }

  async lookupMerchantRule(normalizedName: string): Promise<MerchantRuleRecord | null> {
    return (await this.loadRuleCache()).get(normalizedName) ?? null;
  }

  async upsertMerchantRule(record: MerchantRuleRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO merchant_rules (normalized_name, display_name, category_key, source, is_user_override, last_used_at, hit_count)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
       ON CONFLICT(normalized_name) DO UPDATE SET
         display_name = excluded.display_name,
         category_key = excluded.category_key,
         source = excluded.source,
         is_user_override = excluded.is_user_override,
         last_used_at = datetime('now'),
         hit_count = merchant_rules.hit_count + 1`,
      [record.normalizedName, record.displayName, record.categoryKey, record.source, bool(record.isUserOverride)],
    );
    this.ruleCache?.set(record.normalizedName, { ...record });
  }

  private async deleteMerchantRule(normalizedName: string): Promise<void> {
    await this.db.run('DELETE FROM merchant_rules WHERE normalized_name = ?', [normalizedName]);
    this.ruleCache?.delete(normalizedName);
  }

  async countUserOverrides(): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM merchant_rules WHERE is_user_override = 1');
    return Number(row?.n ?? 0);
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  async insertTransaction(tx: ParsedTransaction): Promise<string> {
    const id = this.newId();
    await this.db.run(
      `INSERT INTO transactions (
        id, dedupe_key, amount_minor, currency_code, is_credit, occurred_at, posted_at,
        merchant_raw, merchant_normalized, merchant_display, account_last4, account_label,
        source_key, txn_kind, reference_id, txn_time, counterparty_vpa,
        gmail_message_id, gmail_thread_id, sender_address, sender_kind, subject, parser_version,
        extraction_method, confidence, confidence_reasons, category_key, category_source,
        is_excluded_from_totals, is_transfer, needs_review, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tx.dedupeKey,
        tx.amountMinor,
        tx.currencyCode,
        bool(tx.isCredit),
        tx.occurredAt.toISOString(),
        tx.postedAt ? tx.postedAt.toISOString() : null,
        tx.merchantRaw,
        tx.merchantNormalized,
        tx.merchantDisplay,
        tx.accountLast4 ?? null,
        tx.accountLabel ?? null,
        tx.sourceKey,
        tx.txnKind,
        tx.referenceId ?? null,
        tx.txnTime ?? null,
        tx.counterpartyVpa ?? null,
        tx.gmailMessageId,
        tx.gmailThreadId ?? null,
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
      ],
    );
    return id;
  }

  async hasTransactionForMessage(messageId: string): Promise<boolean> {
    const row = await this.db.get('SELECT 1 AS hit FROM transactions WHERE gmail_message_id = ? LIMIT 1', [messageId]);
    return row !== null;
  }

  async findDedupeCandidates(amountMinor: number, currencyCode: string, occurredAt: Date, source: string, windowDays = 3): Promise<TransactionRow[]> {
    const from = new Date(occurredAt.getTime() - windowDays * 86_400_000).toISOString();
    const to = new Date(occurredAt.getTime() + windowDays * 86_400_000).toISOString();
    const rows = await this.db.all(
      'SELECT * FROM transactions WHERE amount_minor = ? AND currency_code = ? AND source = ? AND occurred_at BETWEEN ? AND ?',
      [amountMinor, currencyCode, source, from, to],
    );
    return rows.map(mapTransaction);
  }

  async findByDedupeKey(dedupeKey: string, source: string): Promise<TransactionRow | null> {
    const row = await this.db.get('SELECT * FROM transactions WHERE dedupe_key = ? AND source = ? LIMIT 1', [dedupeKey, source]);
    return row ? mapTransaction(row) : null;
  }

  async applyMergeUpdates(id: string, updates: Record<string, unknown>): Promise<void> {
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
    const values: SqlValue[] = [];
    for (const [key, value] of Object.entries(updates)) {
      const column = columnMap[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push(value instanceof Date ? value.toISOString() : (value as SqlValue));
    }
    if (sets.length === 0) return;
    values.push(id);
    await this.db.run(`UPDATE transactions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, values);
  }

  async linkDuplicate(input: DuplicateLinkInput): Promise<void> {
    await this.db.run(
      `INSERT INTO transaction_links (id, primary_transaction_id, duplicate_message_id, duplicate_sender, duplicate_merchant, similarity, match_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(duplicate_message_id) DO NOTHING`,
      [this.newId(), input.primaryTransactionId, input.duplicateMessageId, input.duplicateSender, input.duplicateMerchant, input.similarity, input.matchKind],
    );
  }

  private buildWhere(filter: TransactionFilter): { clause: string; params: SqlValue[] } {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    if (filter.month) {
      conditions.push("strftime('%Y-%m', occurred_at, ?) = ?");
      params.push(this.tz(), filter.month);
    }
    if (filter.categoryKey) {
      if (filter.categoryKey === 'uncategorized') conditions.push('category_key IS NULL');
      else {
        conditions.push('category_key = ?');
        params.push(filter.categoryKey);
      }
    }
    if (filter.search && filter.search.trim() !== '') {
      conditions.push("(merchant_display LIKE ? ESCAPE '\\' OR merchant_raw LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
      const like = `%${filter.search.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
    if (filter.sourceKey) {
      conditions.push('source_key = ?');
      params.push(filter.sourceKey);
    }
    if (filter.needsReview) conditions.push('needs_review = 1');
    if (!filter.includeExcluded) conditions.push('is_excluded_from_totals = 0');
    return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
  }

  async listTransactions(filter: TransactionFilter = {}): Promise<{ rows: TransactionRow[]; total: number }> {
    const { clause, params } = this.buildWhere(filter);
    const limit = Math.min(filter.limit ?? 100, 1000);
    const offset = filter.offset ?? 0;
    const rows = await this.db.all(
      `SELECT t.*, (SELECT COUNT(*) FROM transaction_links l WHERE l.primary_transaction_id = t.id) AS duplicate_count
       FROM transactions t ${clause}
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const total = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions ${clause}`, params);
    return { rows: rows.map(mapTransaction), total: Number(total?.n ?? 0) };
  }

  async getTransaction(id: string): Promise<TransactionRow | null> {
    const row = await this.db.get(
      `SELECT t.*, (SELECT COUNT(*) FROM transaction_links l WHERE l.primary_transaction_id = t.id) AS duplicate_count
       FROM transactions t WHERE t.id = ?`,
      [id],
    );
    return row ? mapTransaction(row) : null;
  }

  async listDuplicateLinks(transactionId: string): Promise<DuplicateLinkRow[]> {
    const rows = await this.db.all('SELECT * FROM transaction_links WHERE primary_transaction_id = ? ORDER BY merged_at', [transactionId]);
    return rows.map((row) => ({
      duplicateMessageId: String(row.duplicate_message_id),
      duplicateSender: str(row.duplicate_sender),
      duplicateMerchant: str(row.duplicate_merchant),
      similarity: Number(row.similarity),
      matchKind: String(row.match_kind),
      mergedAt: String(row.merged_at),
    }));
  }

  async updateTransactionFields(
    id: string,
    fields: { notes?: string | null; isExcludedFromTotals?: boolean; isUserConfirmed?: boolean; needsReview?: boolean },
  ): Promise<TransactionRow> {
    const sets: string[] = [];
    const values: SqlValue[] = [];
    if (fields.notes !== undefined) {
      sets.push('notes = ?');
      values.push(fields.notes === null || fields.notes.trim() === '' ? null : fields.notes.slice(0, 2000));
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
    if (sets.length > 0) {
      values.push(id);
      await this.db.run(`UPDATE transactions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`, values);
    }
    const updated = await this.getTransaction(id);
    if (!updated) throw new NotFoundError('Transaction');
    return updated;
  }

  /**
   * §4: recategorization is remembered for the merchant permanently and "always applied
   * retroactively to all past transactions from that merchant", with an undo.
   */
  async recategorize(id: string, categoryKey: string, options: { applyRetroactively?: boolean } = {}): Promise<RecategorizeResult> {
    const transaction = await this.getTransaction(id);
    if (!transaction) throw new NotFoundError('Transaction');
    const categories = await this.listCategories();
    const category = categories.find((c) => c.key === categoryKey);
    if (!category) throw new ValidationError(`Unknown category "${categoryKey}"`);

    // A name guessed from the sender ("hdfcbank") is shared by every unparsed alert from that
    // bank. Applying one category across all of them would be wrong, so such a change stays on
    // the single transaction and teaches nothing.
    const merchantIsSenderFallback = transaction.confidenceReasons.includes(MERCHANT_FROM_SENDER_REASON);
    const retro =
      options.applyRetroactively !== false && transaction.merchantNormalized !== '' && !merchantIsSenderFallback;
    const scope = retro
      ? await this.db.all('SELECT id, category_key, category_source, is_excluded_from_totals, is_user_confirmed, needs_review FROM transactions WHERE merchant_normalized = ?', [transaction.merchantNormalized])
      : await this.db.all('SELECT id, category_key, category_source, is_excluded_from_totals, is_user_confirmed, needs_review FROM transactions WHERE id = ?', [id]);

    const undo: RecategorizeUndo = {
      transactionId: id,
      merchantNormalized: transaction.merchantNormalized,
      rows: scope.map((row) => ({
        id: String(row.id),
        categoryKey: str(row.category_key),
        categorySource: str(row.category_source),
        isExcludedFromTotals: Number(row.is_excluded_from_totals) === 1,
        isUserConfirmed: Number(row.is_user_confirmed) === 1,
        needsReview: Number(row.needs_review) === 1,
      })),
      previousRule: retro ? await this.lookupMerchantRule(transaction.merchantNormalized) : null,
      ruleTouched: retro,
    };

    await this.db.transaction(async () => {
      await this.db.run(
        `UPDATE transactions SET category_key = ?, category_source = 'user', is_user_confirmed = 1, needs_review = 0,
           is_excluded_from_totals = ?, updated_at = datetime('now') WHERE id = ?`,
        [categoryKey, bool(category.excludedFromTotals), id],
      );
      if (retro) {
        await this.db.run(
          `UPDATE transactions SET category_key = ?, category_source = 'user', is_excluded_from_totals = ?, updated_at = datetime('now')
           WHERE merchant_normalized = ? AND id != ?`,
          [categoryKey, bool(category.excludedFromTotals), transaction.merchantNormalized, id],
        );
      }
    });

    if (retro) {
      await this.upsertMerchantRule({
        normalizedName: transaction.merchantNormalized,
        displayName: transaction.merchantDisplay,
        categoryKey,
        source: 'user',
        isUserOverride: true,
      });
    }

    const updated = await this.getTransaction(id);
    if (!updated) throw new NotFoundError('Transaction');
    return {
      transaction: updated,
      retroactivelyUpdated: Math.max(0, undo.rows.length - 1),
      scope: retro ? 'merchant' : 'transaction',
      undo,
    };
  }

  async undoRecategorize(undo: RecategorizeUndo): Promise<number> {
    await this.db.transaction(async () => {
      for (const row of undo.rows) {
        await this.db.run(
          `UPDATE transactions SET category_key = ?, category_source = ?, is_excluded_from_totals = ?, is_user_confirmed = ?,
             needs_review = ?, updated_at = datetime('now') WHERE id = ?`,
          [row.categoryKey, row.categorySource, bool(row.isExcludedFromTotals), bool(row.isUserConfirmed), bool(row.needsReview), row.id],
        );
      }
    });
    if (undo.ruleTouched) {
      if (undo.previousRule) await this.upsertMerchantRule(undo.previousRule);
      else await this.deleteMerchantRule(undo.merchantNormalized);
    }
    return undo.rows.length;
  }

  async deleteTransaction(id: string): Promise<boolean> {
    const result = await this.db.run('DELETE FROM transactions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  /** Removes every transaction from a source ('sample' for demo data) and its bookkeeping. */
  async deleteBySource(source: string): Promise<number> {
    const prefix = source === 'sample' ? 'sample-%' : null;
    const result = await this.db.run('DELETE FROM transactions WHERE source = ?', [source]);
    if (prefix) {
      await this.db.run('DELETE FROM message_triage WHERE gmail_message_id LIKE ?', [prefix]);
      await this.db.run('DELETE FROM transaction_links WHERE duplicate_message_id LIKE ?', [prefix]);
    }
    return result.changes;
  }

  async countTransactions(source?: string): Promise<number> {
    const row = source
      ? await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE source = ?', [source])
      : await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    return Number(row?.n ?? 0);
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  async monthlyStats(month: string, currency: string, options: { sourceKey?: string } = {}): Promise<MonthlyStats> {
    const tz = this.tz();
    // One account, or all of them. The clause is appended to every aggregate below.
    const sourceKey = options.sourceKey && options.sourceKey !== '' ? options.sourceKey : null;
    const srcClause = sourceKey ? ' AND source_key = ?' : '';
    const srcParam: SqlValue[] = sourceKey ? [sourceKey] : [];
    // §6: refunds subtract. A credit that is not income/transfer reduces spend in the category
    // it was charged to, rather than being reported as income.
    const spend = await this.db.get<{ total: number; n: number }>(
      `SELECT COALESCE(SUM(${SIGNED_AMOUNT}), 0) AS total, COUNT(*) AS n FROM transactions
       WHERE strftime('%Y-%m', occurred_at, ?) = ? AND currency_code = ? AND is_excluded_from_totals = 0${srcClause}`,
      [tz, month, currency, ...srcParam],
    );
    // Every tracked account, even when the figures above are scoped to one of them.
    const sources = await this.db.all(
      `SELECT source_key AS key, COALESCE(SUM(${SIGNED_AMOUNT}), 0) AS total, COUNT(*) AS n FROM transactions
       WHERE strftime('%Y-%m', occurred_at, ?) = ? AND currency_code = ? AND is_excluded_from_totals = 0
       GROUP BY source_key ORDER BY total DESC`,
      [tz, month, currency],
    );
    const income = await this.db.get<{ total: number }>(
      `SELECT COALESCE(SUM(t.amount_minor), 0) AS total FROM transactions t
       WHERE strftime('%Y-%m', t.occurred_at, ?) = ? AND t.currency_code = ? AND t.is_credit = 1
         AND t.txn_kind <> 'refund'
         AND (t.category_key = 'income' OR (t.is_excluded_from_totals = 1 AND t.is_transfer = 0))
         ${sourceKey ? 'AND t.source_key = ?' : ''}`,
      [tz, month, currency, ...srcParam],
    );
    const excluded = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE strftime('%Y-%m', occurred_at, ?) = ? AND is_excluded_from_totals = 1${srcClause}`,
      [tz, month, ...srcParam],
    );
    const review = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE strftime('%Y-%m', occurred_at, ?) = ? AND needs_review = 1${srcClause}`,
      [tz, month, ...srcParam],
    );
    const categories = await this.db.all(
      `SELECT t.category_key AS key, COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.color_hex, '#7A7A7A') AS color,
              COALESCE(c.icon, 'tag') AS icon,
              SUM(CASE WHEN t.is_credit = 1 THEN -t.amount_minor ELSE t.amount_minor END) AS total, COUNT(*) AS n
       FROM transactions t LEFT JOIN categories c ON c.key = t.category_key
       WHERE strftime('%Y-%m', t.occurred_at, ?) = ? AND t.currency_code = ? AND t.is_excluded_from_totals = 0
         ${sourceKey ? 'AND t.source_key = ?' : ''}
       GROUP BY t.category_key ORDER BY total DESC`,
      [tz, month, currency, ...srcParam],
    );
    const byDay = await this.db.all(
      `SELECT date(occurred_at, ?) AS day, SUM(${SIGNED_AMOUNT}) AS total FROM transactions
       WHERE strftime('%Y-%m', occurred_at, ?) = ? AND currency_code = ? AND is_excluded_from_totals = 0${srcClause}
       GROUP BY day ORDER BY day`,
      [tz, tz, month, currency, ...srcParam],
    );
    const merchants = await this.db.all(
      `SELECT MAX(merchant_display) AS merchant, merchant_normalized AS normalized, SUM(${SIGNED_AMOUNT}) AS total, COUNT(*) AS n
       FROM transactions
       WHERE strftime('%Y-%m', occurred_at, ?) = ? AND currency_code = ? AND is_excluded_from_totals = 0${srcClause}
       GROUP BY merchant_normalized ORDER BY total DESC LIMIT 8`,
      [tz, month, currency, ...srcParam],
    );

    const total = Number(spend?.total ?? 0);
    return {
      month,
      currency,
      totalSpentMinor: total,
      totalIncomeMinor: Number(income?.total ?? 0),
      transactionCount: Number(spend?.n ?? 0),
      excludedCount: Number(excluded?.n ?? 0),
      needsReviewCount: Number(review?.n ?? 0),
      sourceKey,
      bySource: (() => {
        const grandTotal = sources.reduce((sum, row) => sum + Number(row.total), 0);
        return sources.map((row) => ({
          sourceKey: String(row.key ?? 'unknown'),
          totalMinor: Number(row.total),
          count: Number(row.n),
          share: grandTotal > 0 ? Number((Number(row.total) / grandTotal).toFixed(4)) : 0,
        }));
      })(),
      byCategory: categories.map((row) => ({
        categoryKey: row.key === null ? 'uncategorized' : String(row.key),
        name: String(row.name),
        colorHex: String(row.color),
        icon: String(row.icon),
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

  async availableMonths(): Promise<string[]> {
    const rows = await this.db.all<{ m: string }>(
      "SELECT DISTINCT strftime('%Y-%m', occurred_at, ?) AS m FROM transactions ORDER BY m DESC",
      [this.tz()],
    );
    return rows.map((r) => String(r.m));
  }

  async distinctCurrencies(): Promise<string[]> {
    const rows = await this.db.all<{ c: string }>('SELECT currency_code AS c, COUNT(*) AS n FROM transactions GROUP BY currency_code ORDER BY n DESC');
    return rows.map((r) => String(r.c));
  }

  /** Everything the dashboard needs for one month, in one call. */
  async summary(options: { month?: string; currency?: string; sourceKey?: string; defaultCurrency: string }): Promise<MonthlySummary> {
    const months = await this.availableMonths();
    const currencies = await this.distinctCurrencies();
    const month = options.month ?? this.currentMonth();
    const currency = (options.currency ?? currencies[0] ?? options.defaultCurrency).toUpperCase();
    const scope = options.sourceKey ? { sourceKey: options.sourceKey } : {};
    const stats = await this.monthlyStats(month, currency, scope);
    const previousMonth = shiftMonth(month, -1);
    const previous = await this.monthlyStats(previousMonth, currency, scope);
    return {
      ...stats,
      availableMonths: months,
      availableCurrencies: currencies.length > 0 ? currencies : [options.defaultCurrency.toUpperCase()],
      previousMonth: { month: previousMonth, totalSpentMinor: previous.totalSpentMinor, transactionCount: previous.transactionCount },
      changeVsPreviousMinor: stats.totalSpentMinor - previous.totalSpentMinor,
    };
  }

  // ── Telemetry, triage, discovery ────────────────────────────────────────────

  async recordParseFailure(input: ParseFailureInput): Promise<void> {
    await this.db.run(
      'INSERT INTO parse_failures (id, sender_domain, subject_shape, stage_reached, reason) VALUES (?, ?, ?, ?, ?)',
      [this.newId(), input.senderDomain, input.subjectShape, input.stageReached, input.reason],
    );
  }

  async parseFailureSummary(limit = 20): Promise<ParseFailureSummaryRow[]> {
    const rows = await this.db.all(
      `SELECT sender_domain, COUNT(*) AS n, MAX(occurred_at) AS last_seen,
              (SELECT stage_reached FROM parse_failures f2 WHERE f2.sender_domain = f1.sender_domain ORDER BY occurred_at DESC LIMIT 1) AS last_stage
       FROM parse_failures f1 GROUP BY sender_domain ORDER BY n DESC LIMIT ?`,
      [limit],
    );
    return rows.map((row) => ({
      senderDomain: String(row.sender_domain),
      count: Number(row.n),
      lastStage: String(row.last_stage ?? ''),
      lastSeen: String(row.last_seen ?? ''),
    }));
  }

  async markTriaged(messageId: string, senderDomain: string, decision: string, parserVersion: string): Promise<void> {
    await this.db.run(
      `INSERT INTO message_triage (gmail_message_id, sender_domain, decision, parser_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(gmail_message_id) DO UPDATE SET decision = excluded.decision, parser_version = excluded.parser_version, seen_at = datetime('now')`,
      [messageId, senderDomain, decision, parserVersion],
    );
  }

  async seenMessageIds(ids: string[], parserVersion: string): Promise<Set<string>> {
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await this.db.all<{ gmail_message_id: string }>(
        `SELECT gmail_message_id FROM message_triage WHERE parser_version = ? AND gmail_message_id IN (${placeholders})`,
        [parserVersion, ...chunk],
      );
      for (const row of rows) seen.add(String(row.gmail_message_id));
    }
    return seen;
  }

  async recordDiscoveredSender(address: string, domain: string, success: boolean): Promise<void> {
    await this.db.run(
      `INSERT INTO discovered_senders (sender_address, sender_domain, success_count, failure_count) VALUES (?, ?, ?, ?)
       ON CONFLICT(sender_address) DO UPDATE SET
         success_count = discovered_senders.success_count + ?,
         failure_count = discovered_senders.failure_count + ?,
         last_seen_at = datetime('now')`,
      [address, domain, success ? 1 : 0, success ? 0 : 1, success ? 1 : 0, success ? 0 : 1],
    );
  }

  /** Senders that parsed successfully enough times are promoted into the Tier-1 allowlist. */
  async promotedSenders(minSuccesses = 2): Promise<string[]> {
    const rows = await this.db.all<{ sender_address: string }>(
      "SELECT sender_address FROM discovered_senders WHERE success_count >= ? AND sender_address NOT LIKE '%@example.%' ORDER BY success_count DESC LIMIT 60",
      [minSuccesses],
    );
    return rows.map((r) => String(r.sender_address));
  }

  async listDiscoveredSenders(): Promise<DiscoveredSenderRow[]> {
    const rows = await this.db.all('SELECT * FROM discovered_senders ORDER BY success_count DESC, failure_count DESC LIMIT 100');
    return rows.map((row) => ({
      address: String(row.sender_address),
      domain: String(row.sender_domain),
      success: Number(row.success_count),
      failure: Number(row.failure_count),
    }));
  }

  // ── Sync state and runs ─────────────────────────────────────────────────────

  async getSyncState(accountEmail: string): Promise<SyncStateRow | null> {
    const row = await this.db.get('SELECT * FROM sync_state WHERE account_email = ?', [accountEmail]);
    if (!row) return null;
    return {
      accountEmail: String(row.account_email),
      lastHistoryId: str(row.last_history_id),
      lastFullSyncAt: str(row.last_full_sync_at),
      lastIncrementalSyncAt: str(row.last_incremental_sync_at),
      lastDiscoverySweepAt: str(row.last_discovery_sweep_at),
      backfillCompletedThrough: str(row.backfill_completed_through),
      rulesPackVersion: str(row.rules_pack_version),
    };
  }

  async upsertSyncState(accountEmail: string, patch: Partial<Omit<SyncStateRow, 'accountEmail'>>): Promise<void> {
    await this.db.run('INSERT INTO sync_state (account_email) VALUES (?) ON CONFLICT(account_email) DO NOTHING', [accountEmail]);
    const columnMap: Record<string, string> = {
      lastHistoryId: 'last_history_id',
      lastFullSyncAt: 'last_full_sync_at',
      lastIncrementalSyncAt: 'last_incremental_sync_at',
      lastDiscoverySweepAt: 'last_discovery_sweep_at',
      backfillCompletedThrough: 'backfill_completed_through',
      rulesPackVersion: 'rules_pack_version',
    };
    const sets: string[] = [];
    const values: SqlValue[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columnMap[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push((value as string | null) ?? null);
    }
    if (sets.length === 0) return;
    values.push(accountEmail);
    await this.db.run(`UPDATE sync_state SET ${sets.join(', ')} WHERE account_email = ?`, values);
  }

  async createSyncRun(kind: string): Promise<string> {
    const id = this.newId();
    await this.db.run("INSERT INTO sync_runs (id, kind, status, phase) VALUES (?, ?, 'running', 'starting')", [id, kind]);
    return id;
  }

  async updateSyncRun(id: string, patch: SyncRunPatch): Promise<void> {
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
    const values: SqlValue[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const column = columnMap[key];
      if (!column) continue;
      sets.push(`${column} = ?`);
      values.push((value as SqlValue | undefined) ?? null);
    }
    if (sets.length === 0) return;
    values.push(id);
    await this.db.run(`UPDATE sync_runs SET ${sets.join(', ')} WHERE id = ?`, values);
  }

  async latestSyncRun(): Promise<SyncRunRow | null> {
    const row = await this.db.get('SELECT * FROM sync_runs ORDER BY started_at DESC, rowid DESC LIMIT 1');
    return row ? mapSyncRun(row) : null;
  }

  async listSyncRuns(limit = 10): Promise<SyncRunRow[]> {
    const rows = await this.db.all('SELECT * FROM sync_runs ORDER BY started_at DESC, rowid DESC LIMIT ?', [limit]);
    return rows.map(mapSyncRun);
  }

  /** A run interrupted by the app being killed must not show as running forever. */
  async markStaleRunsFailed(): Promise<number> {
    const result = await this.db.run(
      "UPDATE sync_runs SET status = 'partial', error_code = 'interrupted', error_message = 'The app closed during sync; it resumes next time.', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'running'",
    );
    return result.changes;
  }

  // ── Settings and lifecycle ──────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row ? String(row.value) : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.run(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      [key, value],
    );
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.run('DELETE FROM app_settings WHERE key = ?', [key]);
  }

  /** Wipes every row (the schema stays). Callers re-seed categories and the dictionary after. */
  async wipeAll(): Promise<void> {
    await this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      for (const table of DATA_TABLES) await this.db.run(`DELETE FROM ${table}`);
    } finally {
      await this.db.exec('PRAGMA foreign_keys = ON');
    }
    this.ruleCache = null;
  }
}
