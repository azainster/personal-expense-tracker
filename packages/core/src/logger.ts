/**
 * The logging contract the engine writes to. The server plugs in its structured, redacting
 * logger; the app plugs in one that only prints in development builds.
 *
 * Callers must never pass email bodies, subjects, tokens or credentials as metadata.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
