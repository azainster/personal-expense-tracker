/** Turns any thrown value into a sentence a person can act on. Never includes email content. */
import { AppError, ReauthRequiredError, UpstreamError } from '@expense/core';

export class NetworkUnavailableError extends Error {
  constructor(message = "You're offline. Connect to the internet and try again.") {
    super(message);
    this.name = 'NetworkUnavailableError';
  }
}

export class AuthCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'AuthCancelledError';
  }
}

export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof NetworkUnavailableError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /Network request failed|network connection was lost|offline|timed out|Failed to fetch|AbortError|aborted/i.test(message);
}

export function userMessage(err: unknown): string {
  if (err instanceof ReauthRequiredError) return 'Your Gmail connection has expired. Reconnect to keep syncing.';
  if (err instanceof NetworkUnavailableError) return err.message;
  if (isNetworkFailure(err)) return "Couldn't reach the network. Check your connection and try again.";
  if (err instanceof UpstreamError) return err.message;
  if (err instanceof AppError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}
