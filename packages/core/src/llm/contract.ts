/**
 * L4 remote-model contract (§1B, §3).
 *
 * The app never talks to Anthropic directly and never holds an API key. It sends an already
 * redacted, truncated snippet to the stateless proxy on our API; the proxy holds the key and
 * returns the typed result. This file is the shared contract between the two ends.
 */

/** Text sent to a model is capped at roughly this many tokens (≈4 chars each). */
export const MAX_MODEL_INPUT_TOKENS = 1500;

export interface LlmExtractionRequest {
  /** Redacted subject. */
  subject: string;
  /** Domain only — never the full sender address. */
  senderDomain: string;
  /** Redacted, truncated body text. */
  text: string;
  defaultCurrency: string;
}

export interface LlmExtraction {
  minorUnits: number;
  currency: string;
  merchant: string;
  isCredit: boolean;
  confidence: number;
}

export interface LlmProvider {
  extract(input: LlmExtractionRequest): Promise<LlmExtraction | null>;
  /** §4 step 6 — one call per *new merchant string*; the caller caches the answer forever. */
  classifyMerchant(merchant: string, categoryKeys: string[]): Promise<string | null>;
  resetBudget?(): void;
  callsUsed?(): number;
}

export const EXTRACTION_SYSTEM_PROMPT = `Extract transaction details from this email.
If it is marketing, a statement summary, a balance notification, or anything other than a single completed transaction, set confidence below 0.3.
Report the amount actually charged or received — never the available balance, credit limit, reward points, or savings.
The text has been redacted: [account], [card], [number], [name], [email], [address] and [link] are placeholders, not merchants.`;

export const CLASSIFY_SYSTEM_PROMPT =
  'Assign the single best spending category for the merchant name given. Answer only with the tool call.';

/** JSON schema for the extraction tool. Mirrors the @Generable struct in the iOS design. */
export const EXTRACTION_TOOL = {
  name: 'record_transaction',
  description: 'Record the single financial transaction described by the email.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Transaction amount in major units, e.g. 1249.00' },
      currency: { type: 'string', description: 'ISO 4217 code, e.g. INR, USD' },
      merchant: { type: 'string', description: 'Merchant or payee name, cleaned of terminal IDs' },
      is_credit: { type: 'boolean', description: 'true if this is a refund, reversal, or credit' },
      confidence: { type: 'number', description: '0.0-1.0 confidence this email is a real single transaction' },
    },
    required: ['amount', 'currency', 'merchant', 'is_credit', 'confidence'],
    additionalProperties: false,
  },
} as const;

export function classifyTool(categoryKeys: string[]) {
  return {
    name: 'assign_category',
    description: 'Assign a spending category to a merchant.',
    input_schema: {
      type: 'object',
      properties: { category: { type: 'string', enum: categoryKeys } },
      required: ['category'],
      additionalProperties: false,
    },
  } as const;
}

/** Validates raw tool arguments from the model and converts the amount to minor units. */
export function normalizeExtraction(
  args: unknown,
  defaultCurrency: string,
  toMinor: (major: number, currency: string) => number,
): LlmExtraction | null {
  if (!args || typeof args !== 'object') return null;
  const input = args as Record<string, unknown>;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currencyRaw = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : defaultCurrency.toUpperCase();
  return {
    minorUnits: toMinor(amount, currency),
    currency,
    merchant: String(input.merchant ?? '').trim().slice(0, 120),
    isCredit: input.is_credit === true,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
  };
}

/** Validates an LlmExtractionRequest arriving over HTTP. Returns an error message or null. */
export function validateExtractionRequest(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (typeof b.text !== 'string' || b.text.trim() === '') return '"text" is required';
  if (b.text.length > MAX_MODEL_INPUT_TOKENS * 4 + 64) return '"text" exceeds the model input budget';
  if (typeof b.subject !== 'string') return '"subject" must be a string';
  if (typeof b.senderDomain !== 'string' || b.senderDomain.includes('@')) return '"senderDomain" must be a bare domain';
  if (typeof b.defaultCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(b.defaultCurrency)) return '"defaultCurrency" must be an ISO 4217 code';
  return null;
}
