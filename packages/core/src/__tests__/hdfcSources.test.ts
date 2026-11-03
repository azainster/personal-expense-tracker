/**
 * HDFC Bank account vs HDFC Pixel Play credit card.
 *
 * Both products mail from `alerts@hdfcbank.net` and every Pixel email also says "Greetings from
 * HDFC Bank!", so the account can only be told from the wording. These tests use the real email
 * text (values changed where they are personal) and cover the numbered cases the app must never
 * get wrong: Pixel evidence outranks generic HDFC evidence, "Credit Card" is not a credit, and a
 * credit into the bank account is not expenditure.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseEmail } from '../parsing/pipeline.js';
import { identifyFinancialSource } from '../parsing/sources.js';
import { ingestMessages, type IngestContext } from '../sync/ingest.js';
import type { EmailMessage, ParseResult } from '../parsing/types.js';
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

const PIXEL_SUBJECT = 'Recent activity update on your Pixel Play Credit Card!';
const PIXEL_BODY = `Dear Customer,

Greetings from HDFC Bank!

Thank you for using your HDFC Bank Pixel Play Credit Card ending with 4763.

We noticed a transaction of Rs. 4000.00 at vyapar.175831025102@hdfcbank on 29/09/26 at 15:51.

You can view more details of this transaction on the PIXEL Homepage inside your PayZapp App.`;

const BANK_DEBIT_SUBJECT = 'View: Account update for your HDFC Bank A/c';
const BANK_DEBIT_BODY = `Dear Customer,

Greetings from HDFC Bank!

Rs.300.00 is debited from your account ending 5120 towards VPA 8279535756@ptsbi (Mohd Asurul) on 14-09-26.

UPI transaction reference no.: 625737835475.`;

const BANK_CREDIT_SUBJECT = 'View: Account update for your HDFC Bank A/c';
const BANK_CREDIT_BODY = `Dear Customer,

Greetings from HDFC Bank!

We're writing to inform you that Rs.600.00 has been successfully credited to your account ending 5120 on 20-09-26.`;

function mail(subject: string, textBody: string, from = 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>', id = 'm1'): EmailMessage {
  return {
    gmailMessageId: id,
    from,
    senderAddress: 'alerts@hdfcbank.net',
    subject,
    headerDate: new Date('2026-09-20T12:00:00Z'),
    textBody,
  };
}

function parsed(result: ParseResult) {
  if (result.status !== 'parsed') throw new Error(`expected a parse, got rejection: ${result.reason}`);
  return result.transaction;
}

describe('which HDFC product an email belongs to', () => {
  it('1 — a Pixel Play subject identifies the card', () => {
    const result = identifyFinancialSource({ pack, senderAddress: 'alerts@hdfcbank.net', subject: PIXEL_SUBJECT, text: '' });
    expect(result.sourceKey).toBe('hdfc_pixel_play');
  });

  it('2 — the card wording in the body identifies the card', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@hdfcbank.net',
      subject: 'Transaction alert',
      text: 'Thank you for using your HDFC Bank Pixel Play Credit Card ending with 4763.',
    });
    expect(result.sourceKey).toBe('hdfc_pixel_play');
  });

  it('3 — Pixel evidence outranks "Greetings from HDFC Bank!"', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@hdfcbank.net',
      subject: PIXEL_SUBJECT,
      text: PIXEL_BODY,
    });
    expect(result.sourceKey).toBe('hdfc_pixel_play');
  });

  it('4 — an account update identifies the bank account', () => {
    const result = identifyFinancialSource({
      pack,
      senderAddress: 'alerts@hdfcbank.net',
      fromHeader: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
      subject: BANK_DEBIT_SUBJECT,
      text: BANK_DEBIT_BODY,
    });
    expect(result.sourceKey).toBe('hdfc_bank');
  });

  it('8 — end to end, a Pixel email is never filed under the bank account', async () => {
    const tx = parsed(await parseEmail(mail(PIXEL_SUBJECT, PIXEL_BODY), deps));
    expect(tx.sourceKey).toBe('hdfc_pixel_play');
    expect(tx.sourceKey).not.toBe('hdfc_bank');
  });
});

describe('parsing the real emails', () => {
  it('5 — an account UPI debit, with the payee name preferred over the VPA', async () => {
    const tx = parsed(await parseEmail(mail(BANK_DEBIT_SUBJECT, BANK_DEBIT_BODY), deps));
    expect(tx.sourceKey).toBe('hdfc_bank');
    expect(tx.txnKind).toBe('debit');
    expect(tx.isCredit).toBe(false);
    expect(tx.amountMinor).toBe(30000);
    expect(tx.accountLast4).toBe('5120');
    expect(tx.merchantRaw).toBe('Mohd Asurul');
    expect(tx.counterpartyVpa).toBe('8279535756@ptsbi');
    expect(tx.referenceId).toBe('625737835475');
    expect(tx.occurredAt.toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(tx.isExcludedFromTotals).toBe(false);
  });

  it('6 — an account credit is recorded but never counted as spending', async () => {
    const tx = parsed(await parseEmail(mail(BANK_CREDIT_SUBJECT, BANK_CREDIT_BODY), deps));
    expect(tx.sourceKey).toBe('hdfc_bank');
    expect(tx.txnKind).toBe('credit');
    expect(tx.isCredit).toBe(true);
    expect(tx.amountMinor).toBe(60000);
    expect(tx.isExcludedFromTotals).toBe(true);
  });

  it('7 — a Pixel Play purchase, with card ending, payee, date and time', async () => {
    const tx = parsed(await parseEmail(mail(PIXEL_SUBJECT, PIXEL_BODY), deps));
    expect(tx.sourceKey).toBe('hdfc_pixel_play');
    expect(tx.txnKind).toBe('purchase');
    expect(tx.isCredit).toBe(false);
    expect(tx.amountMinor).toBe(400000);
    expect(tx.accountLast4).toBe('4763');
    expect(tx.merchantRaw).toBe('vyapar.175831025102@hdfcbank');
    expect(tx.counterpartyVpa).toBe('vyapar.175831025102@hdfcbank');
    expect(tx.txnTime).toBe('15:51');
    expect(tx.occurredAt.toISOString().slice(0, 10)).toBe('2026-09-29');
    expect(tx.isExcludedFromTotals).toBe(false);
  });

  it('the card in "Credit Card" is the account, not the transaction type', async () => {
    const tx = parsed(await parseEmail(mail(PIXEL_SUBJECT, PIXEL_BODY), deps));
    expect(tx.txnKind).not.toBe('credit');
    expect(tx.isCredit).toBe(false);
  });
});

describe('what counts as expenditure', () => {
  let store: SqlStore;
  let ctx: IngestContext;

  beforeEach(async () => {
    store = await freshStore();
    ctx = { store, pack, defaultCurrency: 'INR', localeHint: 'en-IN' };
  });

  it('9 — an account debit adds to HDFC Bank spending', async () => {
    await ingestMessages([mail(BANK_DEBIT_SUBJECT, BANK_DEBIT_BODY, undefined, 'debit-1')], ctx);
    const stats = await store.monthlyStats('2026-09', 'INR');
    const hdfc = stats.bySource.find((s) => s.sourceKey === 'hdfc_bank');
    expect(hdfc?.totalMinor).toBe(30000);
    expect(stats.totalSpentMinor).toBe(30000);
  });

  it('10 — an account credit does not', async () => {
    await ingestMessages(
      [mail(BANK_DEBIT_SUBJECT, BANK_DEBIT_BODY, undefined, 'debit-2'), mail(BANK_CREDIT_SUBJECT, BANK_CREDIT_BODY, undefined, 'credit-1')],
      ctx,
    );
    const stats = await store.monthlyStats('2026-09', 'INR');
    const hdfc = stats.bySource.find((s) => s.sourceKey === 'hdfc_bank');
    expect(hdfc?.totalMinor).toBe(30000);
    expect(stats.totalSpentMinor).toBe(30000);
    // It is still in history, on the right account.
    const { rows } = await store.listTransactions({ includeExcluded: true, sourceKey: 'hdfc_bank' });
    expect(rows.map((r) => r.txnKind).sort()).toEqual(['credit', 'debit']);
  });

  it('keeps the card and the account apart in the same month', async () => {
    await ingestMessages(
      [mail(BANK_DEBIT_SUBJECT, BANK_DEBIT_BODY, undefined, 'd3'), mail(PIXEL_SUBJECT, PIXEL_BODY, 'HDFC Bank <alerts@hdfcbank.net>', 'p3')],
      ctx,
    );
    const stats = await store.monthlyStats('2026-09', 'INR');
    const totals = new Map(stats.bySource.map((s) => [s.sourceKey, s.totalMinor]));
    expect(totals.get('hdfc_bank')).toBe(30000);
    expect(totals.get('hdfc_pixel_play')).toBe(400000);
    expect(stats.totalSpentMinor).toBe(430000);
  });
});
