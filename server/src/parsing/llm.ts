/**
 * L4 — remote LLM (§1B, §3). The Anthropic API key lives here, on the server, and nowhere else.
 *
 * Two callers:
 *  - the stateless proxy at /api/v1/llm/* used by the iPhone app (which has no key); and
 *  - the development server's own sync loop, when ENABLE_REMOTE_LLM_FALLBACK=true.
 *
 * Text is redacted again here even though the app already redacts before sending — defence in
 * depth costs nothing. Nothing sent to or received from the model is logged or stored.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  CLASSIFY_SYSTEM_PROMPT,
  classifyTool,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL,
  MAX_MODEL_INPUT_TOKENS,
  normalizeExtraction,
  redactForModel,
  toMinorUnits,
  truncateForModel,
  UpstreamError,
  type LlmExtraction,
  type LlmExtractionRequest,
  type LlmProvider,
} from '@expense/core';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('llm');

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (config.llm.apiKey === '') return null;
  if (!client) client = new Anthropic({ apiKey: config.llm.apiKey });
  return client;
}

export function isLlmConfigured(): boolean {
  return config.llm.apiKey !== '';
}

/** The server's own sync loop uses L4 only when explicitly opted in. */
export function isLlmAvailable(): boolean {
  return config.llm.enabled && isLlmConfigured();
}

function toTool(definition: { name: string; description: string; input_schema: unknown }): Anthropic.Tool {
  return {
    name: definition.name,
    description: definition.description,
    strict: true,
    input_schema: JSON.parse(JSON.stringify(definition.input_schema)) as Anthropic.Tool.InputSchema,
  };
}

function rethrow(err: unknown, what: string): never {
  if (err instanceof Anthropic.RateLimitError) {
    log.warn(`${what}: rate limited upstream`);
    throw new UpstreamError('The AI fallback is busy. Try again shortly.', { status: 503, retryable: true });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    log.error(`${what}: ANTHROPIC_API_KEY rejected`);
    throw new UpstreamError('The AI fallback is misconfigured on the server.', { status: 503 });
  }
  if (err instanceof Anthropic.APIError) {
    log.error(`${what}: upstream error`, { status: err.status });
    throw new UpstreamError('The AI fallback failed upstream.', { status: 502, retryable: (err.status ?? 500) >= 500 });
  }
  log.error(`${what}: call failed`, { err: err instanceof Error ? err.name : 'unknown' });
  throw new UpstreamError('The AI fallback could not be reached.', { status: 502, retryable: true });
}

/** Returns null when the model declines or reports no single transaction. Throws UpstreamError on API failure. */
export async function extractWithModel(input: LlmExtractionRequest): Promise<LlmExtraction | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const prompt = [
    `Sender domain: ${input.senderDomain}`,
    `Subject: ${redactForModel(input.subject)}`,
    '',
    truncateForModel(redactForModel(input.text), MAX_MODEL_INPUT_TOKENS),
  ].join('\n');

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: config.llm.model,
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      tools: [toTool(EXTRACTION_TOOL)],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    rethrow(err, 'extraction');
  }

  if (response.stop_reason === 'refusal') {
    log.warn('model declined the extraction request', { category: response.stop_details?.category ?? null });
    return null;
  }
  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!block) return null;
  return normalizeExtraction(block.input, input.defaultCurrency, toMinorUnits);
}

/** §4 step 6 — classify one *new merchant string*; callers cache the answer permanently. */
export async function classifyMerchantWithModel(merchant: string, categoryKeys: string[]): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: config.llm.model,
      max_tokens: 256,
      system: CLASSIFY_SYSTEM_PROMPT,
      tools: [toTool(classifyTool(categoryKeys))],
      tool_choice: { type: 'tool', name: 'assign_category' },
      messages: [{ role: 'user', content: `Merchant: ${redactForModel(merchant).slice(0, 120)}` }],
    });
  } catch (err) {
    rethrow(err, 'classification');
  }
  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const category = (block?.input as { category?: string } | undefined)?.category;
  return category && categoryKeys.includes(category) ? category : null;
}

/** Budgeted provider for the server's own sync loop (LLM_MAX_CALLS_PER_SYNC per run). */
function createSyncProvider(): LlmProvider {
  let calls = 0;
  const withBudget = async <T>(fn: () => Promise<T | null>): Promise<T | null> => {
    if (!isLlmAvailable()) return null;
    if (calls >= config.llm.maxCallsPerSync) return null;
    calls += 1;
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  return {
    extract: (input) => withBudget(() => extractWithModel(input)),
    classifyMerchant: (merchant, keys) => withBudget(() => classifyMerchantWithModel(merchant, keys)),
    resetBudget: () => {
      calls = 0;
    },
    callsUsed: () => calls,
  };
}

const syncProvider = createSyncProvider();

export function syncLlmProvider(): LlmProvider | null {
  return isLlmAvailable() ? syncProvider : null;
}
