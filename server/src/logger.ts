/**
 * Structured logger with level filtering and PII redaction.
 *
 * The architecture is explicit that email content must never be persisted or
 * logged. `redact()` is applied to every logged value so that an accidental
 * `logger.info('parsed', { body })` cannot leak an email body into a log file.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Keys whose values are never written to logs, at any depth. */
const SENSITIVE_KEYS = new Set([
  'body', 'html', 'text', 'snippet', 'payload', 'raw', 'emailBody', 'cleanedText',
  'access_token', 'refresh_token', 'accessToken', 'refreshToken', 'id_token',
  'client_secret', 'clientSecret', 'authorization', 'apiKey', 'api_key',
  'code', 'codeVerifier', 'code_verifier',
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_DIGITS_RE = /\b\d{6,}\b/g;

function redactString(value: string): string {
  return value
    .replace(EMAIL_RE, (m) => {
      const at = m.indexOf('@');
      return `${m.slice(0, Math.min(2, at))}***@${m.slice(at + 1)}`;
    })
    .replace(LONG_DIGITS_RE, (m) => `***${m.slice(-4)}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value.length > 500 ? `${value.slice(0, 500)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return '[unserializable]';
}

function emit(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const line: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
  };
  if (meta && Object.keys(meta).length > 0) line.meta = redact(meta);
  const serialized = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${serialized}\n`);
  else process.stdout.write(`${serialized}\n`);
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('app');
