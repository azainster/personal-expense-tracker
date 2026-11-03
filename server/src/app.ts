import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, REPO_ROOT } from './config.js';
import { createLogger } from './logger.js';
import { toHttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { categoriesRouter, transactionsRouter } from './routes/transactions.js';
import { statsRouter } from './routes/stats.js';
import { syncRouter } from './routes/sync.js';
import { debugRouter } from './routes/debug.js';
import { v1Router } from './routes/v1.js';
import { loadRulesPack, PARSER_VERSION } from './parsing/rulespack.js';

const log = createLogger('http');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The development dashboard's routes read and change a single, unauthenticated user's
 * financial data. They answer loopback requests only (unless ALLOW_REMOTE_DEV_API=true), so
 * running the server on 0.0.0.0 for the iPhone never exposes them to the local network.
 * The socket address is used, not req.ip, so X-Forwarded-For cannot spoof it.
 */
function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (config.devApi.allowRemote || LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    next();
    return;
  }
  res.status(403).json({
    error: { code: 'dev_api_local_only', message: 'The development dashboard API only answers requests from this computer.' },
  });
}

export function createApp(): express.Express {
  const app = express();
  // I keep the server factory side-effect free so tests and the production entry point can configure it differently.
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '256kb' }));

  // The dashboard runs on the Vite dev server in development. The iPhone app is a native
  // client and sends no Origin header, so CORS does not apply to it.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origin === config.webOrigin || /^http:\/\/localhost:\d+$/.test(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      // Method, path and status only — never bodies, headers or query strings.
      log[level]('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      parserVersion: PARSER_VERSION,
      rulesPackVersion: loadRulesPack().version,
      googleConfigured: config.google.configured,
      devApi: config.devApi.enabled,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // Public API for the iPhone app.
  app.use('/api/v1', v1Router);

  if (config.devApi.enabled) {
    app.use('/api/auth', localOnly, authRouter);
    app.use('/api/transactions', localOnly, transactionsRouter);
    app.use('/api/categories', localOnly, categoriesRouter);
    app.use('/api/stats', localOnly, statsRouter);
    app.use('/api/sync', localOnly, syncRouter);
    app.use('/api/debug', localOnly, debugRouter);

    // Serve the built dashboard when it exists, so `npm start` is a single process.
    const webDist = resolve(REPO_ROOT, 'web', 'dist');
    if (existsSync(webDist)) {
      app.use(localOnly, express.static(webDist));
      app.get(/^\/(?!api\/).*/, localOnly, (_req, res) => {
        res.sendFile(resolve(webDist, 'index.html'));
      });
    }
  }

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, code, message, details } = toHttpError(err);
    if (status >= 500) log.error('request error', { code, message });
    else log.warn('request failed', { code, message });
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
  });

  return app;
}
