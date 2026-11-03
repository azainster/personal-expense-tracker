import { describe, expect, it } from 'vitest';
import { extractAmountCandidates, selectAmount } from '../parsing/candidates.js';
import { htmlToDocument, plainTextToDocument } from '../parsing/html.js';

const best = (text: string, currency = 'INR') => {
  const selection = selectAmount(extractAmountCandidates(plainTextToDocument(text), { defaultCurrency: currency }));
  return selection?.best ?? null;
};

describe('L2 scored candidate extraction', () => {
  it('picks the debit, not the available balance', () => {
    const amount = best('Rs.450.00 has been debited from account **1234.\nAvl Bal: Rs.1,23,456.78');
    expect(amount?.minorUnits).toBe(45000);
  });

  it('picks the spend, not the credit limit', () => {
    const amount = best('Rs 2,499.00 spent on your card xx5512 at AMAZON.\nAvailable Credit Limit: Rs 1,47,501.00');
    expect(amount?.minorUnits).toBe(249900);
  });

  it('picks the amount paid over MRP and savings', () => {
    const amount = best('MRP: Rs. 34,990.00\nYou saved: Rs. 8,000.00\nAmount paid: Rs. 26,990.00');
    expect(amount?.minorUnits).toBe(2699000);
  });

  it('picks the total over the convenience fee that follows it', () => {
    const amount = best('Amount paid: Rs. 940.00\nConvenience fee: Rs. 88.00 (included)');
    expect(amount?.minorUnits).toBe(94000);
  });

  it('picks the grand total over line items in an HTML table', () => {
    const doc = htmlToDocument(`<table>
      <tr><td>Item Total</td><td>₹620.00</td></tr>
      <tr><td>Delivery Fee</td><td>₹35.00</td></tr>
      <tr><td><b>Grand Total</b></td><td><b>₹613.00</b></td></tr></table>`);
    const selection = selectAmount(extractAmountCandidates(doc, { defaultCurrency: 'INR' }));
    expect(selection?.best.minorUnits).toBe(61300);
  });

  it('does not double-count overlapping phrases', () => {
    // "you saved" must not also fire "you save"; "amount paid" must not also fire "amount"+"paid".
    const candidate = best('Amount paid: Rs. 1,000.00');
    const labels = candidate?.reasons.map((r) => r.label) ?? [];
    expect(labels.filter((l) => l.includes('paid')).length).toBe(1);
  });

  it('flags credits', () => {
    const amount = best('A refund of INR 1,299.00 has been credited to your account.');
    expect(amount?.isCredit).toBe(true);
  });

  it('reports the margin over the runner-up', () => {
    const selection = selectAmount(
      extractAmountCandidates(plainTextToDocument('Total paid Rs 500.00. Available balance Rs 100.00'), {
        defaultCurrency: 'INR',
      }),
    );
    expect(selection?.margin).toBeGreaterThan(0);
  });

  it('returns nothing for text with no money in it', () => {
    expect(best('Your OTP is 884213. Valid for 10 minutes.')).toBeNull();
  });
});
