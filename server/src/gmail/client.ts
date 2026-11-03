/**
 * The development server's Gmail client: the shared @expense/core client, wired to the
 * server's encrypted token vault. Transport policy (token bucket, jittered backoff,
 * history-404 handling) lives in core so the iPhone app behaves identically.
 */
import { GmailClient, type GmailMessage, type GmailProfile, type HistoryPage, type ListPage } from '@expense/core';
import { createLogger } from '../logger.js';
import { getAccessToken, invalidateAccessToken } from './oauth.js';

export const gmailClient = new GmailClient({
  getAccessToken,
  invalidateAccessToken,
  logger: createLogger('gmail:client'),
});

export const listMessages = (query: string, pageToken?: string, maxResults = 100): Promise<ListPage> =>
  gmailClient.listMessages(query, pageToken, maxResults);
export const getMessageMetadata = (id: string): Promise<GmailMessage> => gmailClient.getMessageMetadata(id);
export const getMessageFull = (id: string): Promise<GmailMessage> => gmailClient.getMessageFull(id);
export const getProfile = (): Promise<GmailProfile> => gmailClient.getProfile();
export const listHistory = (startHistoryId: string, pageToken?: string): Promise<HistoryPage> =>
  gmailClient.listHistory(startHistoryId, pageToken);
