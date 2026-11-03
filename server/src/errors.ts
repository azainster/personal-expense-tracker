/**
 * Application error taxonomy. Defined once in @expense/core so the server, the sync engine
 * and the iPhone app throw — and `instanceof`-check — the very same classes.
 */
export {
  AppError,
  ConfigError,
  HistoryExpiredError,
  NotFoundError,
  ReauthRequiredError,
  toHttpError,
  UpstreamError,
  ValidationError,
} from '@expense/core';
