import { describe, expect, it } from 'vitest';
import { cleanMerchantTokens, normalizeMerchant } from '../parsing/merchant.js';
import { senderBrandCandidates, extractMerchantPhrase } from '../parsing/merchantPhrase.js';
import { loadRulesPack } from './helpers.js';

const pack = loadRulesPack();

describe('merchant normalization', () => {
  it('handles the two descriptors from the architecture document', () => {
    expect(normalizeMerchant('POS 4023XXXX5512 AMAZON RETAIL*MK1 BANGALORE IN', pack).normalized).toBe('amazon');
    expect(normalizeMerchant('UPI/P2M/412345678/SWIGGY', pack).normalized).toBe('swiggy');
  });

  it('strips rails, terminal ids, cities, countries and corporate suffixes', () => {
    expect(cleanMerchantTokens('NEFT ACME TECHNOLOGIES PVT LTD MUMBAI IN', pack)).toBe('acme');
    expect(cleanMerchantTokens('POS 1234XXXX9999 STARBUCKS COFFEE NEW DELHI IN', pack)).toBe('starbucks coffee');
  });

  it('resolves aliases and dictionary entries', () => {
    expect(normalizeMerchant('AMZN Mktp IN', pack).normalized).toBe('amazon');
    expect(normalizeMerchant('BUNDL TECHNOLOGIES', pack).normalized).toBe('swiggy');
    expect(normalizeMerchant('Ola Cabs', pack).normalized).toBe('ola');
  });

  it('matches a brand embedded in a single-token descriptor', () => {
    expect(normalizeMerchant('tatastarbucks', pack).normalized).toBe('starbucks');
  });

  it('never returns an empty merchant for a non-empty descriptor', () => {
    // Every token here is a payment-rail word that would otherwise be stripped away.
    const result = normalizeMerchant('UPI POS NEFT', pack);
    expect(result.normalized).not.toBe('');
  });

  it('keeps unknown merchants intact rather than forcing a bad fuzzy match', () => {
    const result = normalizeMerchant('Meghana Foods Koramangala', pack);
    expect(result.matchedDictionary).toBe(false);
    expect(result.normalized).toContain('meghana');
  });
});

describe('sender brand candidates', () => {
  it('skips generic subdomains', () => {
    expect(senderBrandCandidates('info@mailer.netflix.com')).toContain('netflix');
  });

  it('offers the dotless join for brands split by a label boundary', () => {
    expect(senderBrandCandidates('care@cult.fit')).toContain('cultfit');
  });
});

describe('merchant phrase extraction', () => {
  it('finds who was actually paid, not the payment app', () => {
    const phrase = extractMerchantPhrase({
      text: 'Payment successful!\n\nYou paid ₹450.00 to Swiggy on 03-09-2026.',
      subject: 'Payment successful to Swiggy',
      anchorIndex: 30,
    });
    expect(phrase).toBe('Swiggy');
  });

  it('reads the merchant out of a processor receipt subject', () => {
    expect(extractMerchantPhrase({ text: 'Amount paid $16.00', subject: 'Your receipt from Linear' })).toBe('Linear');
  });

  it('returns null when nothing names a merchant', () => {
    expect(extractMerchantPhrase({ text: 'Total 100.00', subject: 'Hello' })).toBeNull();
  });
});
