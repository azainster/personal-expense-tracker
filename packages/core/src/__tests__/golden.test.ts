/**
 * Golden-file suite. Every fixture carries hand-labelled expected output; every parser
 * change runs against this. A fixture that regresses fails here, by name.
 */
import { describe, expect, it } from 'vitest';
import { SAMPLE_EMAILS } from '../fixtures/emails.js';
import { fixtureToEmail } from '../fixtures/load.js';
import { parseEmail } from '../parsing/pipeline.js';
import { loadRulesPack } from './helpers.js';

const pack = loadRulesPack();
const deps = {
  pack,
  lookupMerchantRule: () => null,
  excludedCategories: new Set(pack.categories.filter((c) => c.excludedFromTotals).map((c) => c.key)),
  defaultCurrency: 'INR',
  localeHint: 'en-IN',
};

describe('golden fixtures', () => {
  for (const fixture of SAMPLE_EMAILS) {
    it(`${fixture.id} — ${fixture.expected.status}`, async () => {
      const email = fixtureToEmail(fixture);
      const result = await parseEmail(email, deps);

      if (fixture.expected.status === 'rejected') {
        if (result.status !== 'rejected') {
          throw new Error(
            `expected rejection but parsed ${result.transaction.amountMinor} ${result.transaction.currencyCode} as ${result.transaction.merchantNormalized}`,
          );
        }
        if (fixture.expected.reasonContains) {
          expect(result.reason.toLowerCase()).toContain(fixture.expected.reasonContains.toLowerCase());
        }
        return;
      }

      if (result.status !== 'parsed') {
        throw new Error(`expected a parse but got rejection: ${result.reason} (stage ${result.stageReached})`);
      }

      const tx = result.transaction;
      expect(tx.amountMinor, 'amount').toBe(fixture.expected.amountMinor);
      expect(tx.currencyCode, 'currency').toBe(fixture.expected.currency);
      expect(tx.merchantNormalized, 'merchant').toBe(fixture.expected.merchantNormalized);
      if (fixture.expected.categoryKey) expect(tx.categoryKey, 'category').toBe(fixture.expected.categoryKey);
      if (fixture.expected.extractionMethod) expect(tx.extractionMethod, 'method').toBe(fixture.expected.extractionMethod);
      if (fixture.expected.isCredit !== undefined) expect(tx.isCredit, 'isCredit').toBe(fixture.expected.isCredit);
      if (fixture.expected.accountLast4) expect(tx.accountLast4, 'last4').toBe(fixture.expected.accountLast4);
      if (fixture.expected.isTransfer !== undefined) expect(tx.isTransfer, 'isTransfer').toBe(fixture.expected.isTransfer);
      if (fixture.expected.sourceKey) expect(tx.sourceKey, 'financial source').toBe(fixture.expected.sourceKey);
      if (fixture.expected.txnKind) expect(tx.txnKind, 'kind').toBe(fixture.expected.txnKind);
      if (fixture.expected.referenceId) expect(tx.referenceId, 'reference').toBe(fixture.expected.referenceId);
      if (fixture.expected.txnTime) expect(tx.txnTime, 'time').toBe(fixture.expected.txnTime);
      expect(tx.confidence, 'confidence').toBeGreaterThan(0.35);
    });
  }
});
