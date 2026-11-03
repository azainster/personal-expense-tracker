/**
 * Google OAuth 2.0.
 *
 * The architecture describes the iOS native-client flow (PKCE, no secret). A server-side web
 * app is a *confidential* client, so this uses PKCE **and** the client secret — the correct
 * pairing for a web client. Everything else follows §2.1: access_type=offline,
 * prompt=consent, refresh token encrypted at rest, invalid_grant → clear and re-prompt.
 */
import { createHash, randomBytes } from 'node:crypto';
import { GMAIL_READONLY_SCOPE } from '@expense/core';
import { config } from '../config.js';
import { AppError, ReauthRequiredError, UpstreamError } from '../errors.js';
import { createLogger } from '../logger.js';
import { clearTokens, loadTokens, savePendingAuth, saveTokens, takePendingAuth } from '../db/repo.js';
import { decryptSecret, encryptSecret } from './crypto.js';

const log = createLogger('gmail:oauth');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const PROFILE_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

/** Least privilege: gmail.readonly alone. The account email comes from the Gmail profile. */
export const SCOPES = [GMAIL_READONLY_SCOPE];

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function beginAuthorization(): { url: string; state: string } {
  if (!config.google.configured) {
    throw new AppError('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', {
      status: 503,
      code: 'google_not_configured',
    });
  }
  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  savePendingAuth(state, codeVerifier);

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    // Without both of these there is no refresh token on re-consent.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new UpstreamError('Could not reach Google token endpoint', { retryable: true, cause: err });
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }

  if (!response.ok) {
    const error = String(payload.error ?? 'unknown_error');
    // invalid_grant: revoked, password changed, or the 7-day testing-mode expiry.
    if (error === 'invalid_grant') {
      log.warn('refresh token rejected (invalid_grant) — clearing vault');
      clearTokens();
      throw new ReauthRequiredError();
    }
    throw new UpstreamError(`Google token endpoint returned ${response.status}: ${error}`, {
      status: response.status >= 500 ? 502 : 400,
      retryable: response.status >= 500,
      details: { error, description: String(payload.error_description ?? '') },
    });
  }

  return payload as unknown as TokenResponse;
}

async function fetchAccountEmail(accessToken: string): Promise<string> {
  try {
    const response = await fetch(PROFILE_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return 'unknown';
    const data = (await response.json()) as { emailAddress?: string };
    return data.emailAddress ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function completeAuthorization(code: string, state: string): Promise<{ accountEmail: string }> {
  const codeVerifier = takePendingAuth(state);
  if (!codeVerifier) {
    throw new AppError('OAuth state did not match a pending request. Start the connection again.', {
      status: 400,
      code: 'invalid_state',
    });
  }

  const tokens = await postToken(
    new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  );

  if (!tokens.refresh_token) {
    log.warn('Google returned no refresh token; the grant may already exist without offline access');
  }

  const accountEmail = await fetchAccountEmail(tokens.access_token);
  saveTokens({
    accountEmail,
    refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope ?? SCOPES.join(' '),
  });
  log.info('gmail account connected', { accountEmail });
  return { accountEmail };
}

export interface ConnectionStatus {
  connected: boolean;
  configured: boolean;
  accountEmail: string | null;
  scope: string | null;
  accessTokenExpiresAt: string | null;
  tokenKeyIsEphemeral: boolean;
}

export function connectionStatus(): ConnectionStatus {
  const row = loadTokens();
  return {
    connected: Boolean(row?.refreshTokenEnc || row?.accessTokenEnc),
    configured: config.google.configured,
    accountEmail: row?.accountEmail ?? null,
    scope: row?.scope ?? null,
    accessTokenExpiresAt: row?.accessTokenExpiresAt ?? null,
    tokenKeyIsEphemeral: config.tokenKeyIsEphemeral,
  };
}

/** Returns a valid access token, refreshing when it is within 60s of expiry. */
export async function getAccessToken(): Promise<string> {
  const row = loadTokens();
  if (!row) throw new ReauthRequiredError('No Gmail account is connected.');

  if (row.accessTokenEnc && row.accessTokenExpiresAt) {
    const expiresAt = new Date(row.accessTokenExpiresAt).getTime();
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
      const token = decryptSecret(row.accessTokenEnc);
      if (token) return token;
      log.warn('stored access token could not be decrypted; refreshing');
    }
  }

  if (!row.refreshTokenEnc) throw new ReauthRequiredError('No refresh token stored. Reconnect the Gmail account.');
  const refreshToken = decryptSecret(row.refreshTokenEnc);
  if (!refreshToken) {
    clearTokens();
    throw new ReauthRequiredError('Stored credentials could not be decrypted (TOKEN_ENCRYPTION_KEY changed). Reconnect.');
  }

  const tokens = await postToken(
    new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  );

  saveTokens({
    accountEmail: row.accountEmail,
    refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    scope: tokens.scope ?? row.scope,
  });
  log.debug('access token refreshed');
  return tokens.access_token;
}

/** Forces the next getAccessToken() to refresh — used when Gmail answers 401 mid-sync. */
export function invalidateAccessToken(): void {
  const row = loadTokens();
  if (!row) return;
  saveTokens({ ...row, accessTokenEnc: null, accessTokenExpiresAt: null });
}

/** Revokes the grant at Google and wipes the local vault. */
export async function disconnect(): Promise<void> {
  const row = loadTokens();
  const secret = row?.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null;
  if (secret) {
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: secret }),
      });
    } catch (err) {
      log.warn('token revocation call failed; clearing local vault anyway', { err: String(err) });
    }
  }
  clearTokens();
  log.info('gmail account disconnected');
}
