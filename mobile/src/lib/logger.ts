/**
 * App logger. Prints in development builds only, and only the message plus content-free
 * metadata. Callers must never pass email text, subjects, tokens or amounts tied to merchants.
 */
import type { Logger } from '@expense/core';

const SENSITIVE = /token|secret|code|body|html|text|subject|snippet|authorization|password/i;

function scrub(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) out[key] = SENSITIVE.test(key) ? '[redacted]' : value;
  return out;
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string, meta?: Record<string, unknown>): void {
  if (!__DEV__) return;
  const line = `[${scope}] ${message}`;
  const safe = scrub(meta);
  if (level === 'error') console.error(line, safe ?? '');
  else if (level === 'warn') console.warn(line, safe ?? '');
  else console.log(line, safe ?? '');
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
  };
}
