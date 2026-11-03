/**
 * The persistence contract the ingest and sync engine are written against.
 *
 * Implemented by the on-device SQL store (`SqlStore`, used by the iPhone app) and by the
 * development server's repository. Every method is async so either backend fits.
 */
import type { MerchantRuleRecord } from '../parsing/categorize.js';
import type { ParsedTransaction } from '../parsing/types.js';
import type { SyncRunRow, SyncStateRow, TransactionRow } from '../store/types.js';

export interface ParseFailureInput {
  /** Domain only — never the address. */
  senderDomain: string;
  /** Shape of the subject (`Cur-Num-Word`) — never the subject. */
  subjectShape: string;
  stageReached: string;
  reason: string;
}

export interface DuplicateLinkInput {
  primaryTransactionId: string;
  duplicateMessageId: string;
  duplicateSender: string;
  duplicateMerchant: string;
  similarity: number;
  matchKind: string;
}

export interface IngestStore {
  excludedCategoryKeys(): Promise<Set<string>>;
  /** A synchronous lookup the pipeline can call per email; backed by a cache or a sync DB. */
  merchantRuleLookup(): Promise<(normalizedName: string) => MerchantRuleRecord | null>;
  hasTransactionForMessage(messageId: string): Promise<boolean>;
  recordParseFailure(input: ParseFailureInput): Promise<void>;
  markTriaged(messageId: string, senderDomain: string, decision: string, parserVersion: string): Promise<void>;
  recordDiscoveredSender(address: string, domain: string, success: boolean): Promise<void>;
  /** Only rows from the same `source` are candidates: demo data must never swallow real mail. */
  findByDedupeKey(dedupeKey: string, source: string): Promise<TransactionRow | null>;
  findDedupeCandidates(amountMinor: number, currencyCode: string, occurredAt: Date, source: string): Promise<TransactionRow[]>;
  linkDuplicate(input: DuplicateLinkInput): Promise<void>;
  applyMergeUpdates(id: string, updates: Record<string, unknown>): Promise<void>;
  upsertMerchantRule(record: MerchantRuleRecord): Promise<void>;
  insertTransaction(tx: ParsedTransaction): Promise<string>;
}

export type SyncRunPatch = Partial<Omit<SyncRunRow, 'id' | 'kind' | 'startedAt'>>;

export interface SyncStore extends IngestStore {
  seenMessageIds(ids: string[], parserVersion: string): Promise<Set<string>>;
  promotedSenders(): Promise<string[]>;
  getSyncState(accountEmail: string): Promise<SyncStateRow | null>;
  upsertSyncState(accountEmail: string, patch: Partial<Omit<SyncStateRow, 'accountEmail'>>): Promise<void>;
  createSyncRun(kind: string): Promise<string>;
  updateSyncRun(id: string, patch: SyncRunPatch): Promise<void>;
}
