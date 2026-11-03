import { describe, expect, it } from 'vitest';
import { categorize, detectTransfer, nearestCategoryBySimilarity } from '../parsing/categorize.js';
import { loadRulesPack } from './helpers.js';

const pack = loadRulesPack();
const noRules = () => null;

describe('categorization cascade', () => {
  it('puts a user override above everything else', () => {
    const result = categorize({
      normalizedMerchant: 'starbucks',
      displayMerchant: 'Starbucks',
      pack,
      lookup: () => ({
        normalizedName: 'starbucks',
        displayName: 'Starbucks',
        categoryKey: 'entertainment',
        source: 'user',
        isUserOverride: true,
      }),
    });
    expect(result).toMatchObject({ categoryKey: 'entertainment', source: 'user', confidence: 1 });
  });

  it('uses the bundled dictionary next', () => {
    const result = categorize({ normalizedMerchant: 'swiggy', displayMerchant: 'Swiggy', pack, lookup: noRules });
    expect(result).toMatchObject({ categoryKey: 'food_dining', source: 'dictionary' });
  });

  it('uses an MCC when the dictionary misses', () => {
    const result = categorize({
      normalizedMerchant: 'some unknown shop',
      displayMerchant: 'Some Unknown Shop',
      mcc: '5411',
      pack,
      lookup: noRules,
    });
    expect(result).toMatchObject({ categoryKey: 'groceries', source: 'mcc' });
  });

  it('falls back to keyword rules on merchant tokens', () => {
    const result = categorize({
      normalizedMerchant: 'kumar coffee roasters',
      displayMerchant: 'Kumar Coffee Roasters',
      pack,
      lookup: noRules,
    });
    expect(result).toMatchObject({ categoryKey: 'chai', source: 'keyword' });
  });

  it('falls back to nearest-neighbour similarity for the long tail', () => {
    const nearest = nearestCategoryBySimilarity('starbuck', pack);
    expect(nearest?.categoryKey).toBe('chai');
  });

  it('lands on Other rather than guessing wildly', () => {
    const result = categorize({
      normalizedMerchant: 'qwzx plc',
      displayMerchant: 'Qwzx Plc',
      pack,
      lookup: noRules,
    });
    expect(result.categoryKey).toBe('other');
    expect(result.source).toBe('fallback');
  });

  it('routes self-transfers to Transfers, which is excluded from spend', () => {
    expect(detectTransfer('Amount debited towards transfer to your own account', pack)).toBe(true);
    const result = categorize({
      normalizedMerchant: 'self transfer',
      displayMerchant: 'Self transfer',
      bodyText: 'INR 10,000 debited towards transfer to your own account ending 1234',
      pack,
      lookup: noRules,
    });
    expect(result.categoryKey).toBe('transfers');
    const transfers = pack.categories.find((c) => c.key === 'transfers');
    expect(transfers?.excludedFromTotals).toBe(true);
  });

  it('routes salary credits to Income', () => {
    const result = categorize({
      normalizedMerchant: 'acme',
      displayMerchant: 'Acme',
      bodyText: 'Rs 85,000 is credited to your account from ACME SALARY',
      isCredit: true,
      pack,
      lookup: noRules,
    });
    expect(result.categoryKey).toBe('income');
  });
});
