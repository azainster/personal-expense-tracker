/**
 * Multiple financial sources: three accounts inside one Gmail inbox, two of them sharing a
 * sender domain. These tests are the guard against the two ways that can go wrong — a Pixel
 * Play charge counted as HDFC Bank spending, and two accounts' identical amounts merged into
 * one transaction.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureById } from '../fixtures/emails.js';
import { fixtureToEmail } from '../fixtures/load.js';
import { computeDedupeKey, findDuplicate } from '../parsing/dedupe.js';
import { MERCHANT_FROM_SENDER_REASON, parseEmail } from '../parsing/pipeline.js';
import { identifyFinancialSource, financialSourceInfo, listFinancialSources, UNKNOWN_SOURCE_KEY } from '../parsing/sources.js';
import { deriveTransactionKind, extractClockTime, extractReferenceId, normalizeClockTime } from '../parsing/transactionMeta.js';
import { ingestMessages, type IngestContext } from '../sync/ingest.js';
import type { EmailMessage } from '../parsing/types.js';
import type { SqlStore } from '../store/sqlStore.js';
import { freshStore, loadRulesPack } from './helpers.js';

const pack = loadRulesPack();
const deps = {
  pack,
  lookupMerchantRule: () => null,
  excludedCategories: new Set(pack.categories.filter((c) => c.excludedFromTotals).map((c) => c.key)),
  defaultCurrency: 'INR',
  localeHint: 'en-IN',
};

const email = ({ text, ...over }: Partial<EmailMessage> & { text: string }): EmailMessage => ({
  gmailMessageId: over.gmailMessageId ?? `msg-${Math.random().toString(36).slice(2)}`,
  from: over.from ?? 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
  senderAddress: over.senderAddress ?? 'alerts@hdfcbank.net',
  subject: over.subject ?? 'Transaction alert',
  headerDate: over.headerDate ?? new Date('2026-09-20T12:00:00Z'),
  textBody: text,
  ...over,
});

describe('identifying the financial source', () => {
  it('lists the three tracked accounts, card before its own bank', () => {
    expect(listFinancialSources(pack).map((s) => s.key)).toEqual(['hdfc_pixel_play', 'hdfc_bank', 'union_bank']);
  });

  it('reads the Pixel Play card out of an email sent from the bank’s own address', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@hdfcbank.net',
      subject: 'Update on your HDFC Bank Pixel Play Credit Card',
      text: 'Rs.148.00 has been spent on your HDFC Bank PIXEL Play Credit Card xx4321 at CHAAYOS.',
    });
    expect(result.sourceKey).toBe('hdfc_pixel_play');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('keeps ordinary HDFC alerts on the bank account', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@hdfcbank.net',
      subject: 'You have done a UPI txn. Check details!',
      text: 'Rs.450.00 has been debited from account **1234 to VPA swiggy@icici.',
    });
    expect(result.sourceKey).toBe('hdfc_bank');
  });

  it('never files a Pixel Play alert under the bank account', () => {
    const pixel = 'Rs.500.00 spent on your HDFC Bank PIXEL Play Credit Card xx4321 at SOMEWHERE.';
    const hdfcRule = pack.financialSourcesByKey.get('hdfc_bank');
    expect(hdfcRule?.negativeBodyPatterns.some((re) => re.test(pixel))).toBe(true);
  });

  it('recognises Union Bank of India', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@unionbankofindia.com',
      subject: 'Transaction alert',
      text: 'Your A/c XX7788 is debited for Rs.860.00. -Union Bank of India',
    });
    expect(result.sourceKey).toBe('union_bank');
  });

  it('recognises Union Bank’s real alert address (ubi.bank.in)', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'noreplyubi-txn@ubi.bank.in',
      subject: 'DEBIT TRANSACTION ALERT',
      text: 'Rs.20.00 debited',
    });
    expect(result.sourceKey).toBe('union_bank');
  });

  it('files recurring services under Subscriptions', () => {
    for (const merchant of ['anthropic', 'apple', 'spotify', 'netflix', 'openai', 'icloud']) {
      expect(pack.merchants[merchant]?.category, merchant).toBe('subscriptions');
    }
  });

  it('attributes a vendor invoice to the card that pays it', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'invoice+statements@mail.anthropic.com',
      subject: 'Your invoice from Anthropic',
      text: 'Amount due 2,399.00',
      merchantNormalized: 'anthropic',
    });
    expect(result.sourceKey).toBe('hdfc_pixel_play');
    expect(result.reason).toContain('merchant');
  });

  it('never lets that hint override an account the email itself names', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'noreplyubi-txn@ubi.bank.in',
      subject: 'DEBIT TRANSACTION ALERT',
      text: 'Your A/c XX7788 is debited for Rs.2,399.00 to ANTHROPIC',
      merchantNormalized: 'anthropic',
    });
    expect(result.sourceKey).toBe('union_bank');
  });

  it('leaves merchant receipts and other banks without a tracked source', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'receipts@uber.com',
      subject: 'Your Tuesday evening trip with Uber',
      text: 'Total ₹248.00',
    });
    expect(result.sourceKey).toBe(UNKNOWN_SOURCE_KEY);
    expect(financialSourceInfo(pack, result.sourceKey).shortLabel).toBe('Other');
  });

  it('describes a stored source key for the UI', () => {
    expect(financialSourceInfo(pack, 'hdfc_pixel_play')).toMatchObject({ shortLabel: 'Pixel Play', kind: 'credit_card' });
    expect(financialSourceInfo(pack, 'union_bank')).toMatchObject({ label: 'Union Bank of India', kind: 'bank_account' });
  });
});

describe('what the money did', () => {
  it('separates debits, credits, refunds and transfers', () => {
    const text = (s: string) => ({ text: s, isCredit: true, isTransfer: false });
    expect(deriveTransactionKind({ isCredit: false, isTransfer: false, text: 'spent at shop' })).toBe('debit');
    expect(deriveTransactionKind(text('Your salary has been credited'))).toBe('credit');
    expect(deriveTransactionKind(text('Rs.1,299.00 has been refunded to your card'))).toBe('refund');
    expect(deriveTransactionKind(text('reversal of the failed transaction'))).toBe('refund');
    expect(deriveTransactionKind({ isCredit: false, isTransfer: true, text: 'self transfer' })).toBe('transfer');
  });

  it('lets a template state the kind outright', () => {
    expect(deriveTransactionKind({ isCredit: true, isTransfer: false, text: 'credited to your card', templateKind: 'refund' })).toBe('refund');
  });

  it('pulls references out of the wording banks actually use', () => {
    expect(extractReferenceId('Your UPI transaction reference number is 412345678901.')).toBe('412345678901');
    expect(extractReferenceId('(UPI Ref no 419283746501)')).toBe('419283746501');
    expect(extractReferenceId('UTR: 328194756.')).toBe('328194756');
    expect(extractReferenceId('Avl Bal: Rs.1,23,456.78')).toBeNull();
    expect(extractReferenceId('Available Credit Limit: Rs 1,47,501.00')).toBeNull();
  });

  it('reads the printed transaction time without inventing one', () => {
    expect(normalizeClockTime('08:45:12')).toBe('08:45');
    expect(normalizeClockTime('8:45')).toBe('08:45');
    expect(normalizeClockTime('99:99')).toBeNull();
    expect(extractClockTime('on 20-09-2026 at 20:05 hrs')).toBe('20:05');
    expect(extractClockTime('no time here')).toBeNull();
  });
});

describe('the same amount on two accounts', () => {
  const base = {
    amountMinor: 50000,
    currencyCode: 'INR',
    occurredAt: new Date('2026-09-20T12:00:00Z'),
    merchantNormalized: 'amazon',
    isCredit: false,
  };

  it('gives each account its own dedupe key', () => {
    expect(computeDedupeKey({ ...base, sourceKey: 'hdfc_bank' })).not.toBe(computeDedupeKey({ ...base, sourceKey: 'hdfc_pixel_play' }));
  });

  it('refuses to merge transactions from different accounts', () => {
    const existing = [{ ...base, sourceKey: 'hdfc_bank', dedupeKey: computeDedupeKey({ ...base, sourceKey: 'hdfc_bank' }) }];
    expect(findDuplicate({ ...base, sourceKey: 'hdfc_pixel_play' }, existing)).toBeNull();
    expect(findDuplicate({ ...base, sourceKey: 'hdfc_bank' }, existing)).not.toBeNull();
  });

  it('still merges a bank alert with the merchant receipt that has no account of its own', () => {
    const existing = [{ ...base, sourceKey: 'hdfc_bank', dedupeKey: 'x' }];
    expect(findDuplicate({ ...base, sourceKey: UNKNOWN_SOURCE_KEY }, existing)).not.toBeNull();
  });
});

describe('storing and reporting by source', () => {
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

  it('keeps HDFC Bank, Pixel Play and Union Bank apart end to end', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy'), emailFor('hdfc-pixel-chai'), emailFor('union-upi-grocery')], ctx);
    const { rows } = await store.listTransactions({ includeExcluded: true });
    expect(rows.map((r) => r.sourceKey).sort()).toEqual(['hdfc_bank', 'hdfc_pixel_play', 'union_bank']);

    const pixel = await store.listTransactions({ sourceKey: 'hdfc_pixel_play' });
    expect(pixel.rows).toHaveLength(1);
    expect(pixel.rows[0]!.merchantDisplay).toBe('Chaayos');
    expect(pixel.rows[0]!.accountLabel).toBe('HDFC Pixel Play Credit Card');
    expect(pixel.rows[0]!.txnTime).toBe('08:45');
  });

  it('reports a total plus a figure per account, and scopes categories to one account', async () => {
    await ingestMessages([emailFor('hdfc-upi-swiggy'), emailFor('hdfc-pixel-chai'), emailFor('union-upi-grocery')], ctx);
    const month = store.currentMonth();
    const all = await store.monthlyStats(month, 'INR');
    const bySource = new Map(all.bySource.map((s) => [s.sourceKey, s.totalMinor]));
    expect(bySource.get('hdfc_bank')).toBe(45000);
    expect(bySource.get('hdfc_pixel_play')).toBe(14800);
    expect(bySource.get('union_bank')).toBe(86000);
    expect(all.totalSpentMinor).toBe(145800);
    expect(all.sourceKey).toBeNull();

    const pixelOnly = await store.monthlyStats(month, 'INR', { sourceKey: 'hdfc_pixel_play' });
    expect(pixelOnly.totalSpentMinor).toBe(14800);
    expect(pixelOnly.sourceKey).toBe('hdfc_pixel_play');
    expect(pixelOnly.byCategory.map((c) => c.categoryKey)).toEqual(['chai']);
    // The account cards stay visible even when the rest is filtered.
    expect(pixelOnly.bySource).toHaveLength(3);
  });

  it('does not count a Pixel Play refund as spending', async () => {
    await ingestMessages([emailFor('hdfc-pixel-chai'), emailFor('hdfc-pixel-refund')], ctx);
    const { rows } = await store.listTransactions({ includeExcluded: true, sourceKey: 'hdfc_pixel_play' });
    const refund = rows.find((r) => r.txnKind === 'refund');
    expect(refund).toBeDefined();
    expect(refund!.isCredit).toBe(true);
  });

  it('keeps a manually chosen category through a later sync of the same merchant', async () => {
    await ingestMessages([emailFor('hdfc-pixel-chai')], ctx);
    const { rows } = await store.listTransactions({});
    await store.recategorize(rows[0]!.id, 'food_dining');
    await ingestMessages([emailFor('hdfc-pixel-chai')], ctx, { force: true });
    const after = await store.listTransactions({});
    expect(after.rows.every((r) => r.categoryKey === 'food_dining')).toBe(true);
    const rule = await store.lookupMerchantRule('chaayos');
    expect(rule).toMatchObject({ categoryKey: 'food_dining', isUserOverride: true });
  });

  it('does not spread a category across alerts whose merchant is only the sender name', async () => {
    const alert = (id: string, amount: string): EmailMessage =>
      email({
        gmailMessageId: id,
        subject: 'Recent activity update on your Pixel Play Credit Card!',
        text: `Dear Customer, an amount of Rs.${amount} was used on your card.\nAvl Bal: Rs.10,000.00`,
      });
    await ingestMessages([alert('bank-a', '25.00'), alert('bank-b', '4,999.00')], ctx);

    const { rows } = await store.listTransactions({ includeExcluded: true });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.confidenceReasons.includes(MERCHANT_FROM_SENDER_REASON))).toBe(true);

    const target = rows.find((r) => r.amountMinor === 2500);
    expect(target).toBeDefined();
    const result = await store.recategorize(target!.id, 'chai');

    expect(result.scope).toBe('transaction');
    expect(result.retroactivelyUpdated).toBe(0);
    const after = await store.listTransactions({ includeExcluded: true });
    expect(after.rows.filter((r) => r.categoryKey === 'chai')).toHaveLength(1);
    expect(await store.lookupMerchantRule(target!.merchantNormalized)).toBeNull();
  });

  it('moved the old Cafe category to Chai instead of duplicating it', async () => {
    const categories = await store.listCategories();
    const keys = categories.map((c) => c.key);
    expect(keys).toContain('chai');
    expect(keys).not.toContain('cafe');
    expect(keys).toContain('stuff');
    expect(keys).toContain('subscriptions');
    expect(categories.find((c) => c.key === 'other')?.name).toBe('Miscellaneous');
  });
});
