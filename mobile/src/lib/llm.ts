/**
 * L4 remote-model fallback (§1B): opt-in, redacted, via our stateless proxy. The app holds no
 * Anthropic key. The pipeline redacts and truncates text before calling `extract`; the proxy
 * redacts again. Budgeted per sync run so a bad day can't send hundreds of requests.
 */
import type { LlmExtraction, LlmExtractionRequest, LlmProvider } from '@expense/core';
import { appConfig } from './config';
import { fetchWithTimeout } from './http';
import { createLogger } from './logger';

const log = createLogger('llm');

export interface ProxyHealth {
  reachable: boolean;
  llmProxyAvailable: boolean;
  rulesPackVersion: string | null;
}

export async function checkApiHealth(): Promise<ProxyHealth> {
  if (!appConfig.api.url) return { reachable: false, llmProxyAvailable: false, rulesPackVersion: null };
  try {
    const response = await fetchWithTimeout(`${appConfig.api.url}/api/v1/health`, {}, 8_000);
    if (!response.ok) return { reachable: false, llmProxyAvailable: false, rulesPackVersion: null };
    const body = (await response.json()) as { llmProxyAvailable?: boolean; rulesPackVersion?: string };
    return { reachable: true, llmProxyAvailable: body.llmProxyAvailable === true, rulesPackVersion: body.rulesPackVersion ?? null };
  } catch {
    return { reachable: false, llmProxyAvailable: false, rulesPackVersion: null };
  }
}

export function createProxyLlmProvider(): LlmProvider {
  let calls = 0;
  let disabledForRun = false;

  async function post<T>(path: string, body: unknown): Promise<T | null> {
    if (!appConfig.api.url || disabledForRun) return null;
    if (calls >= appConfig.llm.maxCallsPerSync) return null;
    calls += 1;
    try {
      const response = await fetchWithTimeout(
        `${appConfig.api.url}${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(appConfig.api.appToken ? { 'X-App-Token': appConfig.api.appToken } : {}),
          },
          body: JSON.stringify(body),
        },
        appConfig.llm.timeoutMs,
      );
      if (response.status === 503 || response.status === 429 || response.status === 401) {
        // Proxy disabled, over its rate limit, or token mismatch: stop trying this run.
        disabledForRun = true;
        log.warn('AI fallback unavailable for this run', { status: response.status });
        return null;
      }
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  return {
    async extract(input: LlmExtractionRequest): Promise<LlmExtraction | null> {
      const data = await post<{ result: LlmExtraction | null }>('/api/v1/llm/extract', input);
      return data?.result ?? null;
    },
    async classifyMerchant(merchant: string, categoryKeys: string[]): Promise<string | null> {
      const data = await post<{ categoryKey: string | null }>('/api/v1/llm/categorize', { merchant, categoryKeys });
      return data?.categoryKey && categoryKeys.includes(data.categoryKey) ? data.categoryKey : null;
    },
    resetBudget() {
      calls = 0;
      disabledForRun = false;
    },
    callsUsed() {
      return calls;
    },
  };
}
