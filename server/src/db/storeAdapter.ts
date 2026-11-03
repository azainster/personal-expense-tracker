/**
 * Adapts the development server's synchronous SQLite repository to the async `SyncStore`
 * contract, so the server runs the exact ingest and sync engine the iPhone app runs.
 */
import type { SyncStore } from '@expense/core';
import * as repo from './repo.js';

export const serverStore: SyncStore = {
  excludedCategoryKeys: async () => repo.excludedCategoryKeys(),
  merchantRuleLookup: async () => repo.lookupMerchantRule,
  hasTransactionForMessage: async (messageId) => repo.findByMessageId(messageId) !== null,
  recordParseFailure: async (input) => repo.recordParseFailure(input),
  markTriaged: async (messageId, domain, decision, parserVersion) => repo.markTriaged(messageId, domain, decision, parserVersion),
  recordDiscoveredSender: async (address, domain, success) => repo.recordDiscoveredSender(address, domain, success),
  findByDedupeKey: async (key, source) => repo.findByDedupeKey(key, source),
  findDedupeCandidates: async (amountMinor, currency, occurredAt, source) =>
    repo.findDedupeCandidates(amountMinor, currency, occurredAt, source),
  linkDuplicate: async (input) => repo.linkDuplicate(input),
  applyMergeUpdates: async (id, updates) => repo.applyMergeUpdates(id, updates),
  upsertMerchantRule: async (record) => repo.upsertMerchantRule(record),
  insertTransaction: async (tx) => repo.insertTransaction(tx),
  seenMessageIds: async (ids, parserVersion) => repo.seenMessageIds(ids, parserVersion),
  promotedSenders: async () => repo.promotedSenders(),
  getSyncState: async (accountEmail) => repo.getSyncState(accountEmail),
  upsertSyncState: async (accountEmail, patch) => repo.upsertSyncState(accountEmail, patch),
  createSyncRun: async (kind) => repo.createSyncRun(kind),
  updateSyncRun: async (id, patch) => repo.updateSyncRun(id, patch),
};
