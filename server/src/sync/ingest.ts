/**
 * Ingestion for the development server: the shared @expense/core ingest (parse → dedupe →
 * store) bound to the server's SQLite repository and configuration.
 */
import { ingestMessages as ingestWithContext, type EmailMessage, type IngestOptions, type IngestStats } from '@expense/core';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { serverStore } from '../db/storeAdapter.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { syncLlmProvider } from '../parsing/llm.js';

export type { IngestStats };

const log = createLogger('sync:ingest');

export function ingestMessages(messages: EmailMessage[], options: IngestOptions = {}): Promise<IngestStats> {
  return ingestWithContext(
    messages,
    {
      store: serverStore,
      pack: loadRulesPack(),
      defaultCurrency: config.defaultCurrency,
      localeHint: config.localeHint,
      llm: syncLlmProvider(),
      logger: log,
    },
    options,
  );
}
