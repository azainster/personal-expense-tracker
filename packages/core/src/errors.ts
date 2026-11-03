/** Application error taxonomy. Every thrown error carries an HTTP status and a stable code. */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, opts: { status?: number; code?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.status = opts.status ?? 500;
    this.code = opts.code ?? 'internal_error';
    if (opts.details) this.details = opts.details;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 500, code: 'config_error', details });
    this.name = 'ConfigError';
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, { status: 404, code: 'not_found' });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 400, code: 'validation_error', details });
    this.name = 'ValidationError';
  }
}

/** Gmail refused the credential: revoked, expired (7-day testing mode), or password changed. */
export class ReauthRequiredError extends AppError {
  constructor(message = 'Gmail authorization is no longer valid. Reconnect the account.') {
    super(message, { status: 401, code: 'reauth_required' });
    this.name = 'ReauthRequiredError';
  }
}

/** The Gmail historyId is older than Google's retention window; caller must fall back to full sync. */
export class HistoryExpiredError extends AppError {
  constructor() {
    super('Gmail history window expired; full re-sync required', { status: 409, code: 'history_expired' });
    this.name = 'HistoryExpiredError';
  }
}

export class UpstreamError extends AppError {
  readonly retryable: boolean;
  constructor(message: string, opts: { status?: number; retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { status: opts.status ?? 502, code: 'upstream_error', details: opts.details, cause: opts.cause });
    this.name = 'UpstreamError';
    this.retryable = opts.retryable ?? false;
  }
}

export function toHttpError(err: unknown): { status: number; code: string; message: string; details?: Record<string, unknown> } {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  }
  if (err instanceof Error) {
    return { status: 500, code: 'internal_error', message: err.message };
  }
  return { status: 500, code: 'internal_error', message: 'Unknown error' };
}
