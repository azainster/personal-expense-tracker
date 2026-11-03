import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ConfigError } from './errors.js';
import type { LogLevel } from './logger.js';

const here = dirname(fileURLToPath(import.meta.url));
/** repo root: server/src -> server -> <root> (works for both tsx src/ and dist/) */
export const SERVER_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..');

// Real environment variables always win, then server/.env, then the repo-root .env.
// `override: false` is what makes that precedence hold — with override on, a developer's
// .env would silently replace the DATABASE_PATH a test runner had just set, and the suite
// would run against (and truncate) the real store.
for (const candidate of [resolve(SERVER_ROOT, '.env'), resolve(REPO_ROOT, '.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate, override: false, quiet: true });
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new ConfigError(`Missing required environment variable ${name}`);
    return fallback;
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  if (!Number.isFinite(parsed)) throw new ConfigError(`Environment variable ${name} must be a number, got "${v}"`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Interface to bind. 0.0.0.0 lets an iPhone on the same network reach /api/v1. */
  host: string;
  /** Honour X-Forwarded-For from a reverse proxy (Render, Fly, Railway, nginx). */
  trustProxy: boolean;

  /** The single-user development dashboard API (/api/auth, /api/transactions, …). */
  devApi: {
    enabled: boolean;
    /** Off by default: dev routes answer loopback requests only. */
    allowRemote: boolean;
  };

  /** Stateless LLM proxy for the iPhone app (/api/v1/llm/*). */
  llmProxy: {
    enabled: boolean;
    /** Optional. If set, the app must send it as X-App-Token. Abuse deterrent, not a secret. */
    sharedToken: string;
    ratePerHour: number;
  };
  webOrigin: string;
  publicUrl: string;
  logLevel: LogLevel;
  databasePath: string;

  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    /** True when both client id and secret are present; Gmail routes 503 without it. */
    configured: boolean;
  };

  /** AES-256-GCM key for the token vault (the server-side analogue of the iOS Keychain). */
  tokenEncryptionKey: Buffer;
  tokenKeyIsEphemeral: boolean;

  sync: {
    windowDays: number;
    intervalMinutes: number;
    maxMessagesPerRun: number;
    discoverySweepHours: number;
  };

  llm: {
    enabled: boolean;
    apiKey: string;
    model: string;
    maxCallsPerSync: number;
  };

  defaultCurrency: string;
  /** Locale hint used to disambiguate `1.234` style decimal separators. */
  localeHint: string;
}

function deriveTokenKey(): { key: Buffer; ephemeral: boolean } {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw && raw.trim() !== '') {
    const hex = /^[0-9a-fA-F]{64}$/.test(raw.trim());
    const key = hex ? Buffer.from(raw.trim(), 'hex') : Buffer.from(raw.trim(), 'base64');
    if (key.length !== 32) {
      throw new ConfigError(
        'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars, or base64 of 32 bytes). ' +
          'Generate one with: openssl rand -hex 32',
      );
    }
    return { key, ephemeral: false };
  }
  // No key configured: derive a process-lifetime key so the app still boots for
  // demo/sample-data use. Stored refresh tokens will not survive a restart.
  return { key: Buffer.from(new Uint8Array(32).map(() => Math.floor(Math.random() * 256))), ephemeral: true };
}

function build(): AppConfig {
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const port = num('PORT', 4000);
  const level = str('LOG_LEVEL', env === 'test' ? 'error' : 'info') as LogLevel;
  if (!LOG_LEVELS.includes(level)) throw new ConfigError(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);

  const clientId = str('GOOGLE_CLIENT_ID', '');
  const clientSecret = str('GOOGLE_CLIENT_SECRET', '');
  const { key, ephemeral } = deriveTokenKey();

  return {
    env,
    port,
    host: str('HOST', '0.0.0.0'),
    trustProxy: bool('TRUST_PROXY', env === 'production'),
    devApi: {
      enabled: bool('ENABLE_DEV_API', env !== 'production'),
      allowRemote: bool('ALLOW_REMOTE_DEV_API', false),
    },
    llmProxy: {
      enabled: bool('LLM_PROXY_ENABLED', false),
      sharedToken: str('LLM_PROXY_SHARED_TOKEN', ''),
      ratePerHour: num('LLM_PROXY_RATE_PER_HOUR', 120),
    },
    webOrigin: str('WEB_ORIGIN', 'http://localhost:5173'),
    publicUrl: str('PUBLIC_URL', `http://localhost:${port}`),
    logLevel: level,
    databasePath: (() => {
      const raw = str('DATABASE_PATH', './data/expenses.db');
      return raw === ':memory:' ? raw : resolve(REPO_ROOT, raw);
    })(),
    google: {
      clientId,
      clientSecret,
      redirectUri: str('GOOGLE_REDIRECT_URI', `http://localhost:${port}/api/auth/google/callback`),
      configured: clientId !== '' && clientSecret !== '',
    },
    tokenEncryptionKey: key,
    tokenKeyIsEphemeral: ephemeral,
    sync: {
      windowDays: num('SYNC_WINDOW_DAYS', 35),
      intervalMinutes: num('SYNC_INTERVAL_MINUTES', 0),
      maxMessagesPerRun: num('SYNC_MAX_MESSAGES_PER_RUN', 400),
      discoverySweepHours: num('DISCOVERY_SWEEP_HOURS', 168),
    },
    llm: {
      enabled: bool('ENABLE_REMOTE_LLM_FALLBACK', false),
      apiKey: str('ANTHROPIC_API_KEY', ''),
      model: str('LLM_MODEL', 'claude-haiku-4-5'),
      maxCallsPerSync: num('LLM_MAX_CALLS_PER_SYNC', 25),
    },
    defaultCurrency: str('DEFAULT_CURRENCY', 'INR').toUpperCase(),
    localeHint: str('LOCALE_HINT', 'en-IN'),
  };
}

export const config: AppConfig = build();
