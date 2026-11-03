/**
 * Google OAuth for a native iOS app (§2.1).
 *
 *  - ASWebAuthenticationSession (system browser sheet) via expo-auth-session — never a WebView;
 *  - iOS OAuth client, PKCE S256, **no client secret** (native apps are public clients);
 *  - redirect: `com.googleusercontent.apps.<id>:/oauth2redirect`, registered as a URL scheme;
 *  - `access_type=offline` + `prompt=consent` so Google issues a refresh token;
 *  - scope: `gmail.readonly` only — the account email comes from the Gmail profile;
 *  - refresh token in the Keychain, access token in memory only;
 *  - `invalid_grant` (revoked, password change, 7-day testing-mode expiry) → wipe the Keychain
 *    entry and ask the person to reconnect.
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { GMAIL_READONLY_SCOPE, ReauthRequiredError, UpstreamError } from '@expense/core';
import { appConfig } from './config';
import { AuthCancelledError } from './errors';
import { describeAuthorizeError, describeGmailApiError, describeTokenError } from './googleErrors';
import { fetchWithTimeout, formBody } from './http';
import { createLogger } from './logger';
import { secureStorage } from './secureStorage';

WebBrowser.maybeCompleteAuthSession();

const log = createLogger('auth');

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

const KEY_REFRESH = 'gmail_refresh_token';
const KEY_ACCOUNT = 'gmail_account';

export interface ConnectedAccount {
  email: string;
  scope: string;
  connectedAt: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

let accessToken: { value: string; expiresAt: number } | null = null;
let refreshInFlight: Promise<string> | null = null;
const reauthListeners = new Set<() => void>();

/** Notified whenever stored credentials are found to be invalid. */
export function onReauthRequired(listener: () => void): () => void {
  reauthListeners.add(listener);
  return () => reauthListeners.delete(listener);
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      DISCOVERY.tokenEndpoint as string,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: formBody(params),
      },
      20_000,
    );
  } catch (err) {
    throw new UpstreamError("Couldn't reach Google. Check your connection and try again.", { retryable: true, cause: err });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }

  if (!response.ok) {
    if (payload.error === 'invalid_grant' && params.grant_type === 'refresh_token') {
      log.warn('refresh token rejected (invalid_grant); clearing Keychain');
      await clearCredentials();
      reauthListeners.forEach((l) => l());
      throw new ReauthRequiredError();
    }
    throw new UpstreamError(describeTokenError(response.status, payload), {
      status: response.status >= 500 ? 502 : 400,
      retryable: response.status >= 500,
    });
  }
  return payload as unknown as TokenResponse;
}

async function fetchAccountEmail(token: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithTimeout(PROFILE_URL, { headers: { Authorization: `Bearer ${token}` } });
  } catch (err) {
    throw new UpstreamError('Signed in to Google, but couldn’t reach Gmail. Check your connection and try again.', { retryable: true, cause: err });
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new UpstreamError(describeGmailApiError(response.status, payload, appConfig.google.iosClientId), { status: response.status });
  }
  const data = (await response.json()) as { emailAddress?: string };
  return data.emailAddress ?? 'Gmail account';
}

export async function getConnectedAccount(): Promise<ConnectedAccount | null> {
  try {
    const [raw, refresh] = await Promise.all([secureStorage.get(KEY_ACCOUNT), secureStorage.get(KEY_REFRESH)]);
    if (!raw || !refresh) return null;
    return JSON.parse(raw) as ConnectedAccount;
  } catch (err) {
    log.warn('could not read Keychain', { err: err instanceof Error ? err.name : 'unknown' });
    return null;
  }
}

export async function isConnected(): Promise<boolean> {
  return (await getConnectedAccount()) !== null;
}

/**
 * Runs the full consent flow. Resolves with the account, or throws AuthCancelledError when
 * the person closes the sheet, ReauthRequiredError-free UpstreamError for anything else.
 */
export async function connectGmail(): Promise<ConnectedAccount> {
  if (!appConfig.google.configured || !appConfig.google.redirectUri) {
    throw new UpstreamError(appConfig.google.problem ?? 'Gmail sign-in is not configured in this build.', { status: 400 });
  }

  const request = new AuthSession.AuthRequest({
    clientId: appConfig.google.iosClientId,
    redirectUri: appConfig.google.redirectUri,
    scopes: [GMAIL_READONLY_SCOPE],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  });

  let result: AuthSession.AuthSessionResult;
  try {
    result = await request.promptAsync(DISCOVERY);
  } catch (err) {
    // The native sheet failed to open (for example no window to present from).
    const reason = err instanceof Error && err.message ? err.message : 'unknown error';
    throw new UpstreamError(`Couldn’t open Google’s sign-in sheet (${reason}).`, { status: 500, cause: err });
  }
  if (result.type === 'cancel' || result.type === 'dismiss' || result.type === 'locked') throw new AuthCancelledError();
  if (result.type === 'error') {
    const code = result.params.error ?? result.error?.code ?? 'unknown';
    if (code === 'access_denied') throw new AuthCancelledError();
    throw new UpstreamError(describeAuthorizeError(code, result.params.error_description ?? result.error?.description), { status: 400 });
  }
  if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
    throw new UpstreamError('Google sign-in did not complete. Please try again.', { status: 400 });
  }

  const tokens = await postToken({
    grant_type: 'authorization_code',
    code: result.params.code,
    client_id: appConfig.google.iosClientId,
    redirect_uri: appConfig.google.redirectUri,
    code_verifier: request.codeVerifier,
  });

  // Granular consent lets people untick "Read your email". Without it there is nothing to do.
  const granted = (tokens.scope ?? '').split(/\s+/);
  if (!granted.includes(GMAIL_READONLY_SCOPE)) {
    await revokeToken(tokens.refresh_token ?? tokens.access_token);
    throw new UpstreamError(
      'Gmail read access was not granted. To track expenses, reconnect and leave “View your email messages and settings” ticked.',
      { status: 403 },
    );
  }
  if (!tokens.refresh_token) {
    throw new UpstreamError('Google did not issue a long-lived token. Remove the app at myaccount.google.com/permissions and connect again.', {
      status: 400,
    });
  }

  const email = await fetchAccountEmail(tokens.access_token);
  const account: ConnectedAccount = { email, scope: GMAIL_READONLY_SCOPE, connectedAt: new Date().toISOString() };
  await secureStorage.set(KEY_REFRESH, tokens.refresh_token);
  await secureStorage.set(KEY_ACCOUNT, JSON.stringify(account));
  accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  log.info('gmail connected');
  return account;
}

/** A valid access token, refreshed when within 60 seconds of expiry. Single-flight. */
export async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt - Date.now() > 60_000) return accessToken.value;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await secureStorage.get(KEY_REFRESH);
      if (!refreshToken) throw new ReauthRequiredError('No Gmail account is connected.');
      const tokens = await postToken({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appConfig.google.iosClientId,
      });
      if (tokens.refresh_token) await secureStorage.set(KEY_REFRESH, tokens.refresh_token);
      accessToken = { value: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
      return tokens.access_token;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function invalidateAccessToken(): void {
  accessToken = null;
}

async function revokeToken(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    await fetchWithTimeout(
      DISCOVERY.revocationEndpoint as string,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ token }) },
      10_000,
    );
  } catch {
    log.warn('token revocation failed; local credentials are removed regardless');
  }
}

async function clearCredentials(): Promise<void> {
  accessToken = null;
  await Promise.all([secureStorage.remove(KEY_REFRESH), secureStorage.remove(KEY_ACCOUNT)]);
}

/** §7 Step 1 "Disconnect": revoke at Google, wipe the Keychain. The caller decides about local data. */
export async function disconnectGmail(): Promise<void> {
  const refreshToken = await secureStorage.get(KEY_REFRESH);
  await revokeToken(refreshToken ?? accessToken?.value);
  await clearCredentials();
  log.info('gmail disconnected');
}
