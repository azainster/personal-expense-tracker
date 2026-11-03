/**
 * The public API the iPhone app talks to. Deliberately tiny — §1 "What the server
 * legitimately does":
 *
 *  (A) GET  /api/v1/rules-pack      static rules pack, no user data, ETag-cached
 *  (B) POST /api/v1/llm/extract     opt-in, redacted-only, stateless LLM proxy
 *      POST /api/v1/llm/categorize  one call per new merchant string
 *
 * No email is fetched or stored here, no request body is logged, and there are no accounts.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { validateExtractionRequest } from '@expense/core';
import { config } from '../config.js';
import { AppError, ValidationError } from '../errors.js';
import { rateLimit } from '../rateLimit.js';
import { classifyMerchantWithModel, extractWithModel, isLlmConfigured } from '../parsing/llm.js';
import { PARSER_VERSION, rulesPackForClients } from '../parsing/rulespack.js';
import { asyncHandler } from './helpers.js';

export const v1Router = Router();

function llmProxyAvailable(): boolean {
  return config.llmProxy.enabled && isLlmConfigured();
}

v1Router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    apiVersion: 1,
    parserVersion: PARSER_VERSION,
    rulesPackVersion: rulesPackForClients().version,
    llmProxyAvailable: llmProxyAvailable(),
  });
});

v1Router.get('/rules-pack', (req, res) => {
  // I let the phone cache an unchanged rules pack instead of downloading it on every refresh.
  const { raw, etag, version } = rulesPackForClients();
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Rules-Pack-Version', version);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.json(raw);
});

function requireLlmProxy(req: Request, _res: Response, next: NextFunction): void {
  if (!llmProxyAvailable()) {
    next(new AppError('The AI fallback is not enabled on this server.', { status: 503, code: 'llm_proxy_disabled' }));
    return;
  }
  if (config.llmProxy.sharedToken !== '' && req.headers['x-app-token'] !== config.llmProxy.sharedToken) {
    next(new AppError('Missing or invalid app token.', { status: 401, code: 'invalid_app_token' }));
    return;
  }
  next();
}

const llmLimiter = rateLimit({ windowMs: 3600_000, max: () => config.llmProxy.ratePerHour, name: 'AI fallback' });

v1Router.post(
  '/llm/extract',
  requireLlmProxy,
  llmLimiter,
  asyncHandler(async (req, res) => {
    const problem = validateExtractionRequest(req.body);
    if (problem) throw new ValidationError(problem);
    const body = req.body as { subject: string; senderDomain: string; text: string; defaultCurrency: string };
    const result = await extractWithModel({
      subject: body.subject,
      senderDomain: body.senderDomain.toLowerCase(),
      text: body.text,
      defaultCurrency: body.defaultCurrency.toUpperCase(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ result });
  }),
);

v1Router.post(
  '/llm/categorize',
  requireLlmProxy,
  llmLimiter,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merchant = typeof body.merchant === 'string' ? body.merchant.trim() : '';
    const categoryKeys = Array.isArray(body.categoryKeys) ? body.categoryKeys.filter((k): k is string => typeof k === 'string') : [];
    if (merchant === '' || merchant.length > 120) throw new ValidationError('"merchant" must be 1–120 characters');
    if (categoryKeys.length === 0 || categoryKeys.length > 50) throw new ValidationError('"categoryKeys" must list 1–50 keys');
    const categoryKey = await classifyMerchantWithModel(merchant, categoryKeys);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ categoryKey });
  }),
);
