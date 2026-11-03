/**
 * Turns Google OAuth and Gmail API error responses into messages that name the actual cause.
 * Google's error payloads never contain tokens, but descriptions are still length-capped and only
 * the documented `error` / `error_description` / `status` / `reason` fields are read.
 */

const MAX_DESCRIPTION = 160;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1)}…` : text;
}

/** The Google Cloud project number is the part of an OAuth client ID before the first dash. */
export function projectNumberFromClientId(clientId: string): string | null {
  const match = /^([0-9]+)-/.exec(clientId.trim());
  return match?.[1] ?? null;
}

/** The authorization step (Google's sign-in sheet) redirected back with `error=…`. */
export function describeAuthorizeError(code: string, description?: unknown): string {
  const detail = clean(description);
  if (code === 'invalid_client') {
    return 'Google says this app’s OAuth client does not exist. Check EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID against the iOS client in Google Cloud and rebuild.';
  }
  if (code === 'redirect_uri_mismatch') {
    return 'Google rejected the sign-in redirect. The OAuth client must be of type iOS, with bundle ID com.azainster.expensetracker.';
  }
  return `Google sign-in failed (${code}${detail ? `: ${detail}` : ''}).`;
}

/** The token endpoint (`oauth2.googleapis.com/token`) answered with an error. */
export function describeTokenError(status: number, payload: Record<string, unknown>): string {
  const code = clean(payload.error) ?? `HTTP ${status}`;
  const detail = clean(payload.error_description);
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return `Google rejected this app’s OAuth client (${code}). It must be an iOS client whose bundle ID is com.azainster.expensetracker.`;
  }
  return `Google sign-in failed (${code}${detail ? `: ${detail}` : ''}).`;
}

interface GoogleApiErrorBody {
  error?: {
    code?: number;
    message?: unknown;
    status?: unknown;
    errors?: { reason?: unknown }[];
    details?: { reason?: unknown }[];
  };
}

/** A Gmail REST call made right after sign-in failed. The most common cause is a disabled API. */
export function describeGmailApiError(status: number, payload: unknown, clientId: string): string {
  const error = (payload as GoogleApiErrorBody | null)?.error;
  const reasons = [...(error?.errors ?? []), ...(error?.details ?? [])]
    .map((e) => clean(e?.reason))
    .filter((r): r is string => r !== null);
  const project = projectNumberFromClientId(clientId);

  if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured')) {
    const where = project ? ` in Google Cloud project ${project}` : '';
    return `Signed in, but the Gmail API is not enabled${where}. Enable “Gmail API” under APIs & Services → Library, wait a minute, then connect again.`;
  }
  if (status === 403 && (reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') || reasons.includes('insufficientPermissions'))) {
    return 'Gmail read access was not granted. Reconnect and leave “View your email messages and settings” ticked.';
  }
  const message = clean(error?.message);
  return `Signed in, but Gmail refused the request (HTTP ${status}${message ? `: ${message}` : ''}).`;
}
