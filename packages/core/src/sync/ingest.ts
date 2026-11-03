/**
 * Ingestion: parse → dedupe → store.
 *
 * Shared by the Gmail sync loop and the demo-data seeder, so demo expenses go through exactly
 * the same pipeline real mail does — what you see before connecting Gmail is the real
 * parser's output, not rows pasted into a database.
 */
import { noopLogger, type Logger } from '../logger.js';
import type { LlmProvider } from '../llm/contract.js';
import { parseEmail } from '../parsing/pipeline.js';
import { findDuplicate, mergeDuplicate } from '../parsing/dedupe.js';
import { PARSER_VERSION, type RulesPack } from '../parsing/rulespack.js';
import type { EmailMessage, ParsedTransaction, ParseResult } from '../parsing/types.js';
import type { TransactionRow } from '../store/types.js';
import type { IngestStore } from './store.js';

export interface IngestStats {
  processed: number;
  parsed: number;
  created: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

export interface IngestContext {
  store: IngestStore;
  pack: RulesPack;
  defaultCurrency: string;
  localeHint: string;
  llm?: LlmProvider | null;
  logger?: Logger;
}

export interface IngestOptions {
  /** Re-parse messages that already produced a transaction. */
  force?: boolean;
  onProgress?: (stats: IngestStats) => void;
}

export function emptyIngestStats(): IngestStats {
  return { processed: 0, parsed: 0, created: 0, duplicates: 0, skipped: 0, failed: 0 };
}

function senderDomainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase() : 'unknown';
}

export async function ingestMessages(
  messages: EmailMessage[],
  ctx: IngestContext,
  options: IngestOptions = {},
): Promise<IngestStats> {
  const { store, pack } = ctx;
  const log = ctx.logger ?? noopLogger;
  const excluded = await store.excludedCategoryKeys();
  const lookupMerchantRule = await store.merchantRuleLookup();
  const stats = emptyIngestStats();

  const deps = {
    pack,
    lookupMerchantRule,
    excludedCategories: excluded,
    defaultCurrency: ctx.defaultCurrency,
    localeHint: ctx.localeHint,
    llm: ctx.llm ?? null,
    logger: log,
  };

  for (const message of messages) {
    stats.processed += 1;
    const domain = senderDomainOf(message.senderAddress);

    if (!options.force && (await store.hasTransactionForMessage(message.gmailMessageId))) {
      stats.skipped += 1;
      continue;
    }

    let result: ParseResult;
    try {
      result = await parseEmail(message, deps);
    } catch (err) {
      stats.failed += 1;
      log.error('pipeline threw', { messageId: message.gmailMessageId, err: err instanceof Error ? err.message : String(err) });
      await store.recordParseFailure({
        senderDomain: domain,
        subjectShape: 'error',
        stageReached: 'exception',
        reason: err instanceof Error ? err.name : 'exception',
      });
      options.onProgress?.(stats);
      continue;
    }

    if (result.status === 'rejected') {
      stats.failed += 1;
      await store.recordParseFailure({
        senderDomain: result.senderDomain,
        subjectShape: result.subjectShape,
        stageReached: result.stageReached,
        reason: result.reason,
      });
      await store.markTriaged(message.gmailMessageId, domain, 'rejected', PARSER_VERSION);
      await store.recordDiscoveredSender(message.senderAddress, domain, false);
      options.onProgress?.(stats);
      continue;
    }

    stats.parsed += 1;
    const tx = result.transaction;

    const duplicate = await findDuplicateFor(store, tx);
    if (duplicate) {
      stats.duplicates += 1;
      await store.linkDuplicate({
        primaryTransactionId: duplicate.row.id,
        duplicateMessageId: tx.gmailMessageId,
        duplicateSender: tx.senderAddress,
        duplicateMerchant: tx.merchantDisplay,
        similarity: duplicate.similarity,
        matchKind: duplicate.kind,
      });
      const updates = mergeDuplicate(
        {
          merchantRaw: duplicate.row.merchantRaw,
          merchantNormalized: duplicate.row.merchantNormalized,
          merchantDisplay: duplicate.row.merchantDisplay,
          accountLast4: duplicate.row.accountLast4,
          accountLabel: duplicate.row.accountLabel,
          occurredAt: new Date(duplicate.row.occurredAt),
          confidence: duplicate.row.confidence,
          extractionMethod: duplicate.row.extractionMethod,
          senderKind: duplicate.row.senderKind,
        },
        {
          merchantRaw: tx.merchantRaw,
          merchantNormalized: tx.merchantNormalized,
          merchantDisplay: tx.merchantDisplay,
          accountLast4: tx.accountLast4,
          accountLabel: tx.accountLabel,
          occurredAt: tx.occurredAt,
          confidence: tx.confidence,
          extractionMethod: tx.extractionMethod,
          senderKind: tx.senderKind,
        },
      );
      if (Object.keys(updates).length > 0) await store.applyMergeUpdates(duplicate.row.id, updates as Record<string, unknown>);
      await store.markTriaged(tx.gmailMessageId, domain, 'duplicate', PARSER_VERSION);
      await store.recordDiscoveredSender(message.senderAddress, domain, true);
      options.onProgress?.(stats);
      continue;
    }

    // §4 step 6: one LLM call per *new merchant string*, cached into merchant_rules.
    if (tx.categoryKey === 'other' && ctx.llm && tx.merchantNormalized !== '' && !lookupMerchantRule(tx.merchantNormalized)) {
      let categoryKey: string | null = null;
      try {
        categoryKey = await ctx.llm.classifyMerchant(tx.merchantDisplay, pack.categories.map((c) => c.key));
      } catch (err) {
        log.warn('merchant classification failed', { err: err instanceof Error ? err.message : String(err) });
      }
      if (categoryKey) {
        tx.categoryKey = categoryKey;
        tx.categorySource = 'llm';
        tx.isExcludedFromTotals = excluded.has(categoryKey);
        await store.upsertMerchantRule({
          normalizedName: tx.merchantNormalized,
          displayName: tx.merchantDisplay,
          categoryKey,
          source: 'llm',
          isUserOverride: false,
        });
      }
    }

    try {
      await store.insertTransaction(tx);
      stats.created += 1;
      await store.markTriaged(tx.gmailMessageId, domain, 'transaction', PARSER_VERSION);
      await store.recordDiscoveredSender(message.senderAddress, domain, true);
      if (tx.categorySource === 'dictionary' || tx.categorySource === 'keyword' || tx.categorySource === 'mcc') {
        await store.upsertMerchantRule({
          normalizedName: tx.merchantNormalized,
          displayName: tx.merchantDisplay,
          categoryKey: tx.categoryKey,
          source: tx.categorySource === 'dictionary' ? 'bundled' : tx.categorySource,
          isUserOverride: false,
        });
      }
    } catch (err) {
      stats.failed += 1;
      log.error('failed to store transaction', { messageId: tx.gmailMessageId, err: err instanceof Error ? err.message : String(err) });
    }

    options.onProgress?.(stats);
  }

  log.info('ingest complete', { ...stats });
  return stats;
}

async function findDuplicateFor(
  store: IngestStore,
  tx: ParsedTransaction,
): Promise<{ row: TransactionRow; similarity: number; kind: string } | null> {
  const exact = await store.findByDedupeKey(tx.dedupeKey, tx.source);
  if (exact && exact.gmailMessageId !== tx.gmailMessageId) return { row: exact, similarity: 1, kind: 'exact-key' };

  const candidates = (await store.findDedupeCandidates(tx.amountMinor, tx.currencyCode, tx.occurredAt, tx.source)).filter(
    (row) => row.gmailMessageId !== tx.gmailMessageId,
  );
  if (candidates.length === 0) return null;

  const match = findDuplicate(
    {
      amountMinor: tx.amountMinor,
      currencyCode: tx.currencyCode,
      occurredAt: tx.occurredAt,
      merchantNormalized: tx.merchantNormalized,
      accountLast4: tx.accountLast4,
      isCredit: tx.isCredit,
      sourceKey: tx.sourceKey,
    },
    candidates.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) })),
  );
  if (!match) return null;

  const original = candidates.find((c) => c.id === match.existing.id);
  return original ? { row: original, similarity: match.similarity, kind: match.kind } : null;
}
