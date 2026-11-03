/**
 * Parser report — `npm run parse-report -w server [fixtureId ...]`
 *
 * Prints every fixture whose parse disagrees with its hand-labelled expectation, with the
 * cascade stages and the full scored-candidate list. Naming fixtures prints them all,
 * matched or not. The Parser lab tab in the dashboard shows the same trace for one email;
 * this is the terminal view across the whole corpus.
 */
import { fixtureToEmail, parseEmail, SAMPLE_EMAILS } from '@expense/core';
import { loadRulesPack } from '../parsing/rulespack.js';

const pack = loadRulesPack();
const deps = {
  pack,
  lookupMerchantRule: () => null,
  excludedCategories: new Set(['transfers', 'income']),
  defaultCurrency: 'INR',
  localeHint: 'en-IN',
};
const only = process.argv.slice(2);

for (const fixture of SAMPLE_EMAILS) {
  if (only.length > 0 && !only.includes(fixture.id)) continue;
  const result = await parseEmail(fixtureToEmail(fixture), deps);
  const exp = fixture.expected;
  if (result.status === 'parsed') {
    const t = result.transaction;
    const ok = exp.status === 'parsed' && t.amountMinor === exp.amountMinor && t.currencyCode === exp.currency && t.merchantNormalized === exp.merchantNormalized && (!exp.categoryKey || t.categoryKey === exp.categoryKey) && (!exp.extractionMethod || t.extractionMethod === exp.extractionMethod);
    if (ok && only.length === 0) continue;
    console.log(`\n=== ${fixture.id} ===`);
    console.log(` got: ${t.amountMinor} ${t.currencyCode} | merch="${t.merchantNormalized}" (raw="${t.merchantRaw}") | cat=${t.categoryKey}/${t.categorySource} | method=${t.extractionMethod} | conf=${t.confidence}`);
    if (exp.status === 'parsed') console.log(` exp: ${exp.amountMinor} ${exp.currency} | merch="${exp.merchantNormalized}" | cat=${exp.categoryKey ?? '-'} | method=${exp.extractionMethod ?? '-'}`);
    console.log(` stages: ${result.debug.stages.join(' → ')}`);
    for (const c of result.debug.amountCandidates.slice(0, 5)) {
      console.log(`   cand ${c.score.toFixed(2)} ${c.minorUnits} ${c.currency} "${c.raw}" :: ${c.reasons.join(', ')}`);
    }
  } else {
    console.log(`\n=== ${fixture.id} === REJECTED: ${result.reason} @ ${result.stageReached}`);
    console.log(` stages: ${result.debug.stages.join(' → ')}`);
    if (only.length > 0) console.log(` text: ${JSON.stringify(result.debug.cleanedText?.slice(0, 600))}`);
  }
}
