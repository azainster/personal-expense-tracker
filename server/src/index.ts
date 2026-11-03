import { config } from './config.js';
import { createLogger, setLogLevel } from './logger.js';
import { closeDb, getDb } from './db/index.js';
import * as repo from './db/repo.js';
import { loadRulesPack } from './parsing/rulespack.js';
import { isLlmConfigured } from './parsing/llm.js';
import { createApp } from './app.js';
import { startScheduler } from './sync/service.js';

const log = createLogger('server');

function bootstrap(): void {
  setLogLevel(config.logLevel);

  // Fail fast on a broken rules pack — the app downloads it from here.
  const pack = loadRulesPack();

  // The database only backs the development dashboard. A production deployment that only
  // serves /api/v1 (rules pack + LLM proxy) is stateless and never opens it.
  let scheduler: NodeJS.Timeout | null = null;
  if (config.devApi.enabled) {
    getDb();
    repo.seedCategories(pack.categories);
    repo.seedMerchantRules(pack);
    // A sync that was interrupted by a restart must not stay "running" forever.
    repo.markStaleRunsFailed();
    scheduler = startScheduler();
  }

  log.info('startup', {
    env: config.env,
    rulesPackVersion: pack.version,
    devApi: config.devApi.enabled,
    llmProxy: config.llmProxy.enabled && isLlmConfigured(),
    googleConfigured: config.google.configured,
  });

  if (config.devApi.enabled && !config.google.configured) {
    log.warn('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are unset — dashboard Gmail sync is disabled. Sample data still works.');
  }
  if (config.devApi.enabled && config.tokenKeyIsEphemeral) {
    log.warn('TOKEN_ENCRYPTION_KEY is unset — stored dashboard Gmail credentials will not survive a restart.');
  }
  if (config.llmProxy.enabled && !isLlmConfigured()) {
    log.warn('LLM_PROXY_ENABLED is true but ANTHROPIC_API_KEY is empty — /api/v1/llm/* will answer 503.');
  }

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info(`listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  });

  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    if (scheduler) clearInterval(scheduler);
    server.close(() => {
      if (config.devApi.enabled) closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('unhandled promise rejection', { reason: String(reason) }));
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err: String(err) });
    shutdown('uncaughtException');
  });
}

bootstrap();
