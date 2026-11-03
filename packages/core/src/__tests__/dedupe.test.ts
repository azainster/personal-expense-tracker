import { describe, expect, it } from 'vitest';
import { computeDedupeKey, findDuplicate, mergeDuplicate } from '../parsing/dedupe.js';
import { jaroWinkler } from '../parsing/similarity.js';

const base = {
  amountMinor: 45000,
  currencyCode: 'INR',
  occurredAt: new Date('2026-09-03T12:00:00Z'),
  merchantNormalized: 'swiggy',
  isCredit: false,
};

describe('dedupe key', () => {
  it('is stable across times on the same day', () => {
    const a = computeDedupeKey({ ...base, occurredAt: new Date('2026-09-03T01:00:00Z') });
    const b = computeDedupeKey({ ...base, occurredAt: new Date('2026-09-03T23:00:00Z') });
    expect(a).toBe(b);
  });

  it('separates different amounts, merchants and directions', () => {
    const key = computeDedupeKey(base);
    expect(computeDedupeKey({ ...base, amountMinor: 45001 })).not.toBe(key);
    expect(computeDedupeKey({ ...base, merchantNormalized: 'zomato' })).not.toBe(key);
    expect(computeDedupeKey({ ...base, isCredit: true })).not.toBe(key);
  });
});

describe('fuzzy duplicate detection', () => {
  it('matches the same purchase reported by bank and merchant', () => {
    const existing = [{ ...base, dedupeKey: computeDedupeKey(base), merchantNormalized: 'swiggy' }];
    const match = findDuplicate({ ...base, occurredAt: new Date('2026-09-04T09:00:00Z') }, existing);
    expect(match?.kind).toBe('fuzzy-merchant');
  });

  it('matches on card last-4 when the merchant strings disagree', () => {
    const existing = [
      { ...base, merchantNormalized: 'pos terminal 8841', accountLast4: '5512', dedupeKey: 'x' },
    ];
    const match = findDuplicate({ ...base, merchantNormalized: 'blue tokai', accountLast4: '5512' }, existing);
    expect(match?.kind).toBe('fuzzy-last4');
  });

  it('does not match beyond the ±3 day window', () => {
    const existing = [{ ...base, dedupeKey: 'x' }];
    const match = findDuplicate({ ...base, occurredAt: new Date('2026-09-09T12:00:00Z') }, existing);
    expect(match).toBeNull();
  });

  it('does not match a refund against the matching debit', () => {
    const existing = [{ ...base, dedupeKey: 'x' }];
    expect(findDuplicate({ ...base, isCredit: true }, existing)).toBeNull();
  });

  it('uses the architecture threshold for merchant similarity', () => {
    expect(jaroWinkler('swiggy', 'swiggy')).toBe(1);
    expect(jaroWinkler('swiggy', 'zomato')).toBeLessThan(0.85);
  });
});

describe('merge rule', () => {
  const bankAlert = {
    merchantRaw: 'POS 4023XXXX5512 AMAZON RETAIL*MK1',
    merchantNormalized: 'amazon',
    merchantDisplay: 'Amazon',
    accountLast4: '5512',
    accountLabel: 'HDFC Bank',
    occurredAt: new Date('2026-09-05T12:00:00Z'),
    confidence: 0.96,
    extractionMethod: 'template',
    senderKind: 'bank',
  };
  const merchantReceipt = {
    merchantRaw: 'Amazon.in',
    merchantNormalized: 'amazon',
    merchantDisplay: 'Amazon',
    accountLast4: null,
    accountLabel: null,
    occurredAt: new Date('2026-09-04T12:00:00Z'),
    confidence: 0.94,
    extractionMethod: 'jsonld',
    senderKind: 'merchant',
  };

  it('takes the merchant name from the merchant receipt', () => {
    const updates = mergeDuplicate(bankAlert, merchantReceipt);
    expect(updates.merchantRaw).toBe('Amazon.in');
  });

  it('takes the card from the bank alert and the earliest date', () => {
    const updates = mergeDuplicate(merchantReceipt, bankAlert);
    expect(updates.accountLast4).toBe('5512');
    expect(updates.occurredAt).toBeUndefined(); // bank alert is later, so the date is kept
    const reverse = mergeDuplicate(bankAlert, merchantReceipt);
    expect(reverse.occurredAt).toEqual(merchantReceipt.occurredAt);
  });
});
