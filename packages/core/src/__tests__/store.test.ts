/**
 * The on-device store against real SQLite: fixtures → pipeline → dedupe → store → stats.
 *
 * Phase 1 exit criteria include "zero duplicates in the month total", and §3 calls
 * triple-counting "the single most trust-destroying bug this app can have".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureById, SAMPLE_EMAILS } from '../fixtures/emails.js';
import { fixtureToEmail } from '../fixtures/load.js';
import { ingestMessages, type IngestContext } from '../sync/ingest.js';
import type { SqlStore } from '../store/sqlStore.js';
import type { EmailMessage } from '../parsing/types.js';
import { freshStore, loadRulesPack } from './helpers.js';

const pack = loadRulesPack();
let store: SqlStore;
let ctx: IngestContext;

beforeEach(async () => {
  store = await freshStore();
  ctx = { store, pack, defaultCurrency: 'INR', localeHint: 'en-IN' };
});

const emailFor = (id: string): EmailMessage => {
  const fixture = fixtureById(id);
  if (!fixture) throw new Error(`unknown fixture ${id}`);
  return fixtureToEmail(fixture);
};

describe('ingest into the on-device store', () => {
  it('stores a parsed transaction with its provenance', async () => {
    const stats = await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    expect(stats.created).toBe(1);
    const { rows } = await store.listTransactions({});
    expect(rows).toHaveLength(1);
    const tx = rows[0]!;
    expect(tx.amountMinor).toBe(45000);
    expect(tx.merchantNormalized).toBe('swiggy');
    expect(tx.categoryKey).toBe('food_dining');
    expect(tx.extractionMethod).toBe('template');
    expect(tx.gmailMessageId).toBe('sample-hdfc-upi-swiggy');
  });

  it('does not double-count the bank alert and the merchant receipt', async () => {
    const stats = await ingestMessages([emailFor('hdfc-card-amazon'), emailFor('amazon-order-confirm')], ctx);
    expect(stats.created).toBe(1);
    expect(stats.duplicates).toBe(1);
    const { rows } = await store.listTransactions({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.duplicateCount).toBe(1);
    const links = await store.listDuplicateLinks(rows[0]!.id);
    expect(links[0]!.duplicateMessageId).toBe('sample-amazon-order-confirm');
  });

  it('does not triple-count bank alert + payment app', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy'), emailFor('phonepe-swiggy-confirm')], ctx);
    const { rows } = await store.listTransactions({});
    expect(rows.filter((r) => r.merchantNormalized === 'swiggy' && r.amountMinor === 45000)).toHaveLength(1);
  });

  it('is idempotent — re-ingesting the same corpus creates nothing new', async () => {
    const emails = SAMPLE_EMAILS.map((f) => fixtureToEmail(f));
    const first = await ingestMessages(emails, ctx);
    const count = await store.countTransactions();
    const second = await ingestMessages(emails, ctx);
    expect(first.created).toBeGreaterThan(10);
    expect(second.created).toBe(0);
    expect(await store.countTransactions()).toBe(count);
  });

  it('never merges real mail into demo data', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    const real = { ...emailFor('hdfc-upi-swiggy'), gmailMessageId: 'gm-real-1', source: 'gmail' };
    const stats = await ingestMessages([real], ctx);
    expect(stats.created).toBe(1);
    expect(stats.duplicates).toBe(0);
    expect(await store.deleteBySource('sample')).toBe(1);
    expect(await store.countTransactions()).toBe(1);
  });

  it('records content-free telemetry for emails it cannot parse', async () => {
    await ingestMessages([emailFor('myntra-marketing')], ctx);
    const failures = await store.parseFailureSummary();
    expect(failures[0]!.senderDomain).toBe('myntramail.com');
    const rows = await store.db.all<{ subject_shape: string }>('SELECT subject_shape FROM parse_failures');
    expect(rows[0]!.subject_shape).not.toContain('OFF');
  });

  it('keeps transfers and income out of spend totals', async () => {
    await ingestMessages([emailFor('icici-self-transfer'), emailFor('hdfc-salary-credit'), emailFor('hdfc-upi-swiggy')], ctx);
    const all = (await store.listTransactions({ includeExcluded: true })).rows;
    const transfer = all.find((r) => r.isTransfer)!;
    const salary = all.find((r) => r.categoryKey === 'income')!;
    expect(transfer.isExcludedFromTotals).toBe(true);
    const stats = await store.monthlyStats(salary.occurredAt.slice(0, 7), 'INR');
    expect(stats.byCategory.some((c) => c.categoryKey === 'transfers' || c.categoryKey === 'income')).toBe(false);
    expect(stats.totalIncomeMinor).toBe(8500000);
  });

  it('records a refund in its category without counting it as spending', async () => {
    // Expenditure is money out only: credits, refunds and transfers are kept in history but
    // never added to (or subtracted from) a month's spending.
    await ingestMessages([emailFor('hdfc-card-amazon'), emailFor('amazon-refund')], ctx);
    const rows = (await store.listTransactions({ includeExcluded: true })).rows;
    const refund = rows.find((r) => r.isCredit)!;
    const charge = rows.find((r) => !r.isCredit)!;
    expect(refund.categoryKey).toBe('shopping');
    expect(refund.txnKind).toBe('refund');
    expect(refund.isExcludedFromTotals).toBe(true);
    if (refund.occurredAt.slice(0, 7) === charge.occurredAt.slice(0, 7)) {
      const stats = await store.monthlyStats(refund.occurredAt.slice(0, 7), 'INR');
      expect(stats.totalSpentMinor).toBe(charge.amountMinor);
      expect(stats.totalIncomeMinor).toBe(0);
    }
  });

  it('builds a month summary whose category totals add up', async () => {
    await ingestMessages(SAMPLE_EMAILS.map((f) => fixtureToEmail(f)), ctx);
    const months = await store.availableMonths();
    const summary = await store.summary({ month: months[0]!, defaultCurrency: 'INR' });
    expect(summary.byCategory.reduce((s, c) => s + c.totalMinor, 0)).toBe(summary.totalSpentMinor);
    expect(summary.byDay.reduce((s, d) => s + d.totalMinor, 0)).toBe(summary.totalSpentMinor);
    expect(summary.availableCurrencies).toContain('INR');
    expect(summary.previousMonth.month).not.toBe(summary.month);
  });
});

describe('recategorization', () => {
  it('applies retroactively to every transaction from that merchant, is remembered, and undoes fully', async () => {
    const coffee1 = emailFor('starbucks-inr');
    const coffee2 = { ...coffee1, gmailMessageId: 'sample-starbucks-2', headerDate: new Date(coffee1.headerDate.getTime() - 10 * 86_400_000) };
    coffee2.textBody = coffee1.textBody?.replace('350', '420');
    coffee2.htmlBody = coffee1.htmlBody?.replace(/350/g, '420');
    await ingestMessages([coffee1, coffee2], ctx);
    const rows = (await store.listTransactions({})).rows.filter((r) => r.merchantNormalized === 'starbucks');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const before = rows.map((r) => r.categoryKey);

    const result = await store.recategorize(rows[0]!.id, 'food_dining');
    expect(result.transaction.categoryKey).toBe('food_dining');
    expect(result.transaction.categorySource).toBe('user');
    expect(result.retroactivelyUpdated).toBe(rows.length - 1);
    const rule = await store.lookupMerchantRule('starbucks');
    expect(rule?.isUserOverride).toBe(true);

    // A future email from the same merchant lands in the user's category.
    const coffee3 = { ...coffee1, gmailMessageId: 'sample-starbucks-3', headerDate: new Date(coffee1.headerDate.getTime() - 20 * 86_400_000) };
    coffee3.textBody = coffee1.textBody?.replace('350', '510');
    coffee3.htmlBody = coffee1.htmlBody?.replace(/350/g, '510');
    await ingestMessages([coffee3], ctx);
    const third = (await store.listTransactions({})).rows.find((r) => r.gmailMessageId === 'sample-starbucks-3');
    if (third) expect(third.categoryKey).toBe('food_dining');

    await store.undoRecategorize(result.undo);
    const restored = await Promise.all(rows.map((r) => store.getTransaction(r.id)));
    expect(restored.map((r) => r!.categoryKey)).toEqual(before);
    expect((await store.lookupMerchantRule('starbucks'))?.isUserOverride ?? false).toBe(false);
  });

  it('moving a transaction to Transfers excludes it from totals', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    const tx = (await store.listTransactions({})).rows[0]!;
    const result = await store.recategorize(tx.id, 'transfers');
    expect(result.transaction.isExcludedFromTotals).toBe(true);
    expect((await store.monthlyStats(tx.occurredAt.slice(0, 7), 'INR')).totalSpentMinor).toBe(0);
  });

  it('rejects unknown categories', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    const tx = (await store.listTransactions({})).rows[0]!;
    await expect(store.recategorize(tx.id, 'nope')).rejects.toThrow(/Unknown category/);
  });
});

describe('store housekeeping', () => {
  it('groups months in local time', async () => {
    const ist = await freshStore(330);
    const email = emailFor('hdfc-upi-swiggy');
    await ingestMessages([email], { ...ctx, store: ist });
    const tx = (await ist.listTransactions({})).rows[0]!;
    // Force a timestamp 30 minutes before local midnight at the start of a month, in UTC.
    await ist.db.run('UPDATE transactions SET occurred_at = ? WHERE id = ?', ['2026-08-31T19:00:00.000Z', tx.id]);
    expect(await ist.availableMonths()).toEqual(['2026-09']);
    expect((await ist.listTransactions({ month: '2026-09' })).total).toBe(1);
  });

  it('updates notes, exclusion and confirmation', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    const tx = (await store.listTransactions({})).rows[0]!;
    const updated = await store.updateTransactionFields(tx.id, { notes: 'team lunch', isExcludedFromTotals: true, isUserConfirmed: true });
    expect(updated.notes).toBe('team lunch');
    expect(updated.isExcludedFromTotals).toBe(true);
    expect((await store.listTransactions({ search: 'team' })).total).toBe(0);
    expect((await store.listTransactions({ search: 'team', includeExcluded: true })).total).toBe(1);
  });

  it('treats search wildcards literally', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy')], ctx);
    expect((await store.listTransactions({ search: '%' })).total).toBe(0);
  });

  it('wipes everything', async () => {
    await ingestMessages(SAMPLE_EMAILS.map((f) => fixtureToEmail(f)), ctx);
    await store.setSetting('x', '1');
    await store.wipeAll();
    expect(await store.countTransactions()).toBe(0);
    expect(await store.getSetting('x')).toBeNull();
    expect(await store.listCategories()).toHaveLength(0);
  });
});
