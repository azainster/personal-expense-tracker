/**
 * Redaction for the opt-in remote LLM fallback (§1B).
 *
 * "Redact before sending: strip account numbers, names, addresses, URLs with tokens; send a
 * normalized snippet." Money amounts must survive redaction or the call is pointless, so
 * long digit runs adjacent to a currency marker are preserved.
 */

const CURRENCY_NEARBY = /(?:₹|Rs\.?|INR|USD|EUR|GBP|\$|€|£)\s*$/i;

export function redactForModel(text: string): string {
  let out = text;

  // URLs (and any token in their query string).
  out = out.replace(/https?:\/\/\S+/gi, '[link]');
  out = out.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[email]');

  // Card numbers and masked account fragments.
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, '[card]');
  out = out.replace(/\b[Xx*]{2,}\s?\d{2,6}\b/g, '[account]');
  out = out.replace(/\b[Aa]\/[Cc]\s*(?:no\.?)?\s*[:#]?\s*\w+/g, 'A/c [account]');

  // Long digit runs that are not amounts.
  out = out.replace(/\b\d{6,}\b/g, (match, offset: number) => {
    const before = out.slice(Math.max(0, offset - 8), offset);
    return CURRENCY_NEARBY.test(before) ? match : '[number]';
  });

  // Personal salutations and signatures.
  out = out.replace(/\b(Dear|Hi|Hello)\s+(?:Mr\.?|Ms\.?|Mrs\.?)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, '$1 [name]');
  out = out.replace(/\b(Regards|Sincerely|Thanks),?\s*\n\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, '$1, [name]');

  // Addresses: number + street-ish words.
  out = out.replace(/\b\d{1,4}[,\s]+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Block|Nagar|Layout|Colony)\b[^\n,]*/g, '[address]');

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
