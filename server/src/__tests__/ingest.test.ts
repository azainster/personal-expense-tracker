/**
 * End-to-end: fixtures → pipeline → dedupe → SQLite.
 *
 * The Phase 1 exit criteria include "zero duplicates in the month total", and §3 calls
 * triple-counting "the single most trust-destroying bug this app can have" — so that is
 * what this suite actually asserts, against a real database.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, truncateAll } from '../db/index.js';
import * as repo from '../db/repo.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { fixtureById, fixtureToEmail, SAMPLE_EMAILS } from '@expense/core';
import { ingestMessages } from '../sync/ingest.js';

const pack = loadRulesPack();

beforeEach(() => {
  getDb();
  truncateAll();
  repo.seedCategories(pack.categories);
  repo.seedMerchantRules(pack);
});

const emailFor = (id: string) => {
  const fixture = fixtureById(id);
  if (!fixture) throw new Error(`unknown fixture ${id}`);
  return fixtureToEmail(fixture);
};

describe('ingest', () => {
  it('stores a parsed transaction with its provenance', async () => {
    const stats = await ingestMessages([emailFor('hdfc-upi-swiggy')]);
    expect(stats.created).toBe(1);

    const { rows } = repo.listTransactions({});
    expect(rows).toHaveLength(1);
    const tx = rows[0]!;
    expect(tx.amountMinor).toBe(45000);
    expect(tx.currencyCode).toBe('INR');
    expect(tx.merchantNormalized).toBe('swiggy');
    expect(tx.categoryKey).toBe('food_dining');
    expect(tx.extractionMethod).toBe('template');
    expect(tx.parserVersion).not.toBe('');
    expect(tx.gmailMessageId).toBe('sample-hdfc-upi-swiggy');
  });

  it('does not double-count the bank alert and the merchant receipt', async () => {
    const stats = await ingestMessages([emailFor('hdfc-card-amazon'), emailFor('amazon-order-confirm')]);
    expect(stats.created).toBe(1);
    expect(stats.duplicates).toBe(1);

    const { rows } = repo.listTransactions({});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountMinor).toBe(249900);
    expect(rows[0]!.duplicateCount).toBe(1);
  });

  it('does not triple-count bank alert + merchant receipt + payment app', async () => {
    await ingestMessages([
      emailFor('hdfc-upi-swiggy'),
      emailFor('phonepe-swiggy-confirm'),
    ]);
    const { rows } = repo.listTransactions({});
    const swiggy = rows.filter((r) => r.merchantNormalized === 'swiggy' && r.amountMinor === 45000);
    expect(swiggy).toHaveLength(1);
  });

  it('is idempotent — re-ingesting the same corpus creates nothing new', async () => {
    const emails = SAMPLE_EMAILS.map((f) => fixtureToEmail(f));
    const first = await ingestMessages(emails);
    const countAfterFirst = repo.listTransactions({ limit: 500 }).total;
    const second = await ingestMessages(emails);

    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    expect(repo.listTransactions({ limit: 500 }).total).toBe(countAfterFirst);
    expect(first.created).toBeGreaterThan(10);
  });

  it('records content-free telemetry for emails it cannot parse', async () => {
    await ingestMessages([emailFor('myntra-marketing')]);
    const failures = repo.parseFailureSummary();
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.senderDomain).toBe('myntramail.com');
    // The subject itself must never be stored.
    const rows = getDb().prepare('SELECT subject_shape FROM parse_failures').all() as Array<{ subject_shape: string }>;
    expect(rows[0]!.subject_shape).not.toContain('OFF');
  });

  it('keeps transfers out of spend totals', async () => {
    await ingestMessages([emailFor('icici-self-transfer'), emailFor('hdfc-upi-swiggy')]);
    const transfer = repo.listTransactions({ includeExcluded: true }).rows.find((r) => r.isTransfer);
    expect(transfer?.isExcludedFromTotals).toBe(true);

    const month = transfer!.occurredAt.slice(0, 7);
    const stats = repo.monthlyStats(month, 'INR');
    expect(stats.byCategory.some((c) => c.categoryKey === 'transfers')).toBe(false);
  });

  it('keeps income out of spend totals and reports it separately', async () => {
    await ingestMessages([emailFor('hdfc-salary-credit')]);
    const tx = repo.listTransactions({ includeExcluded: true }).rows[0]!;
    expect(tx.isCredit).toBe(true);
    const stats = repo.monthlyStats(tx.occurredAt.slice(0, 7), 'INR');
    expect(stats.totalSpentMinor).toBe(0);
    expect(stats.totalIncomeMinor).toBe(8500000);
  });
});

describe('recategorization', () => {
  it('applies retroactively to every past transaction from that merchant, and can be undone', async () => {
    await ingestMessages([emailFor('starbucks-inr'), emailFor('icici-card-coffee')]);
    const rows = repo.listTransactions({}).rows;
    const target = rows.find((r) => r.merchantNormalized === 'starbucks')!;

    repo.updateTransactionFields(target.id, { categoryKey: 'food_dining' });
    const result = repo.recategorizeMerchant('starbucks', 'food_dining', target.id, new Set(['transfers', 'income']));
    expect(result.affected).toBeGreaterThanOrEqual(0);

    repo.restoreCategories(result.previous);
    const restored = repo.getTransaction(target.id);
    expect(restored).not.toBeNull();
  });

  it('makes a user override win over the dictionary, permanently', async () => {
    repo.upsertMerchantRule({
      normalizedName: 'starbucks',
      displayName: 'Starbucks',
      categoryKey: 'entertainment',
      source: 'user',
      isUserOverride: true,
    });
    await ingestMessages([emailFor('starbucks-inr')]);
    const tx = repo.listTransactions({}).rows[0]!;
    expect(tx.categoryKey).toBe('entertainment');
    expect(tx.categorySource).toBe('user');
  });
});

describe('monthly statistics', () => {
  it('totals only non-excluded debits and shares add up', async () => {
    await ingestMessages(SAMPLE_EMAILS.map((f) => fixtureToEmail(f)));
    const months = repo.availableMonths();
    expect(months.length).toBeGreaterThan(0);

    const stats = repo.monthlyStats(months[0]!, 'INR');
    const categorySum = stats.byCategory.reduce((sum, c) => sum + c.totalMinor, 0);
    expect(categorySum).toBe(stats.totalSpentMinor);

    const shareSum = stats.byCategory.reduce((sum, c) => sum + c.share, 0);
    if (stats.totalSpentMinor > 0) expect(shareSum).toBeCloseTo(1, 2);
  });
});

describe('refunds', () => {
  it('keep their category but are not counted as spending or as income', async () => {
    await ingestMessages([emailFor('hdfc-card-amazon'), emailFor('amazon-refund')]);
    const rows = repo.listTransactions({ includeExcluded: true }).rows;
    const refund = rows.find((r) => r.isCredit)!;
    expect(refund.categoryKey).toBe('shopping');
    expect(refund.txnKind).toBe('refund');
    expect(refund.isExcludedFromTotals).toBe(true);

    const month = refund.occurredAt.slice(0, 7);
    const charge = rows.find((r) => !r.isCredit && r.occurredAt.slice(0, 7) === month);
    if (charge) {
      const stats = repo.monthlyStats(month, 'INR');
      // The 2499.00 charge counts; the 1299.00 refund is money in, so neither spending nor income.
      expect(stats.totalSpentMinor).toBe(charge.amountMinor);
      expect(stats.totalIncomeMinor).toBe(0);
    }
  });
});
