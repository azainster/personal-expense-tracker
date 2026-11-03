import { describe, expect, it } from 'vitest';
import { describeAuthorizeError, describeGmailApiError, describeTokenError, projectNumberFromClientId } from '../googleErrors';

const CLIENT_ID = '352298514140-abc123.apps.googleusercontent.com';

describe('Google error messages', () => {
  it('reads the Cloud project number from the client ID', () => {
    expect(projectNumberFromClientId(CLIENT_ID)).toBe('352298514140');
    expect(projectNumberFromClientId('not-a-client')).toBeNull();
  });

  it('names a disabled Gmail API instead of a generic failure', () => {
    const body = {
      error: {
        code: 403,
        message: 'Gmail API has not been used in project 352298514140 before or it is disabled.',
        status: 'PERMISSION_DENIED',
        errors: [{ reason: 'accessNotConfigured' }],
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    };
    const message = describeGmailApiError(403, body, CLIENT_ID);
    expect(message).toContain('Gmail API is not enabled');
    expect(message).toContain('352298514140');
  });

  it('explains a missing Gmail scope', () => {
    const body = { error: { code: 403, errors: [{ reason: 'insufficientPermissions' }] } };
    expect(describeGmailApiError(403, body, CLIENT_ID)).toContain('Gmail read access was not granted');
  });

  it('falls back to the HTTP status and Google message for other Gmail errors', () => {
    expect(describeGmailApiError(500, { error: { message: 'Backend Error' } }, CLIENT_ID)).toBe(
      'Signed in, but Gmail refused the request (HTTP 500: Backend Error).',
    );
    expect(describeGmailApiError(502, null, CLIENT_ID)).toBe('Signed in, but Gmail refused the request (HTTP 502).');
  });

  it('includes the token endpoint error code and description', () => {
    expect(describeTokenError(400, { error: 'invalid_request', error_description: 'Missing code verifier.' })).toBe(
      'Google sign-in failed (invalid_request: Missing code verifier.).',
    );
    expect(describeTokenError(401, { error: 'invalid_client' })).toContain('OAuth client');
    expect(describeTokenError(503, {})).toBe('Google sign-in failed (HTTP 503).');
  });

  it('describes authorization redirect errors', () => {
    expect(describeAuthorizeError('invalid_client')).toContain('does not exist');
    expect(describeAuthorizeError('invalid_scope', 'Some requested scopes were invalid.')).toBe(
      'Google sign-in failed (invalid_scope: Some requested scopes were invalid.).',
    );
    expect(describeAuthorizeError('server_error', 'x'.repeat(500)).length).toBeLessThan(220);
  });
});
