/**
 * The debug surface §7 Step 2 asks for on day one: "Debug screen dumping raw parsed text.
 * You will live in it."
 *
 * It shows exactly what the pipeline saw — the stripped text, every scored candidate with
 * the reason for each point, which cascade stage answered, and why something was rejected.
 */
import { Router } from 'express';
import {
  extractBodies,
  fixtureToEmail,
  headerValue,
  parseAddress,
  parseEmail,
  parseInternalDate,
  SAMPLE_EMAILS,
  type EmailMessage,
} from '@expense/core';
import { config } from '../config.js';
import { loadRulesPack, matchSender, PARSER_VERSION } from '../parsing/rulespack.js';
import { syncLlmProvider } from '../parsing/llm.js';
import { getMessageFull } from '../gmail/client.js';
import { connectionStatus } from '../gmail/oauth.js';
import * as repo from '../db/repo.js';
import { asyncHandler, optionalString } from './helpers.js';
import { NotFoundError, ValidationError, AppError } from '../errors.js';

export const debugRouter = Router();

function deps() {
  return {
    pack: loadRulesPack(),
    lookupMerchantRule: repo.lookupMerchantRule,
    excludedCategories: repo.excludedCategoryKeys(),
    defaultCurrency: config.defaultCurrency,
    localeHint: config.localeHint,
    llm: syncLlmProvider(),
  };
}

debugRouter.get('/fixtures', (_req, res) => {
  res.json({
    fixtures: SAMPLE_EMAILS.map((f) => ({
      id: f.id,
      from: f.from,
      subject: f.subject,
      daysAgo: f.daysAgo,
      expected: f.expected,
      hasHtml: Boolean(f.html),
    })),
  });
});

/** Parses a fixture, or arbitrary pasted email text, and returns the full trace. */
debugRouter.post(
  '/parse',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let email: EmailMessage;

    const fixtureId = optionalString(body.fixtureId);
    if (fixtureId) {
      const fixture = SAMPLE_EMAILS.find((f) => f.id === fixtureId);
      if (!fixture) throw new NotFoundError(`Fixture "${fixtureId}"`);
      email = fixtureToEmail(fixture);
    } else {
      const from = optionalString(body.from);
      const text = optionalString(body.text);
      const html = optionalString(body.html);
      if (!from || (!text && !html)) {
        throw new ValidationError('Supply either a fixtureId, or from plus text/html');
      }
      email = {
        gmailMessageId: `debug-${Date.now()}`,
        from,
        senderAddress: parseAddress(from),
        subject: optionalString(body.subject) ?? '',
        headerDate: new Date(),
        source: 'debug',
      };
      if (text) email.textBody = text;
      if (html) email.htmlBody = html;
    }

    const pack = loadRulesPack();
    const result = await parseEmail(email, deps());
    res.json({
      input: {
        from: email.from,
        senderAddress: email.senderAddress,
        subject: email.subject,
        headerDate: email.headerDate,
        matchedSender: matchSender(pack, email.senderAddress)?.id ?? null,
      },
      result,
      parserVersion: PARSER_VERSION,
      rulesPackVersion: pack.version,
    });
  }),
);

/** Re-fetch a real Gmail message by id and show its trace. Nothing is stored. */
debugRouter.get(
  '/message/:id',
  asyncHandler(async (req, res) => {
    if (!connectionStatus().connected) {
      throw new AppError('Connect a Gmail account first.', { status: 409, code: 'not_connected' });
    }
    const message = await getMessageFull(String(req.params.id));
    const from = headerValue(message.payload, 'From');
    const bodies = extractBodies(message.payload);
    const email: EmailMessage = {
      gmailMessageId: message.id,
      from,
      senderAddress: parseAddress(from),
      subject: headerValue(message.payload, 'Subject'),
      headerDate: parseInternalDate(message),
      source: 'debug',
    };
    if (bodies.text) email.textBody = bodies.text;
    if (bodies.html) email.htmlBody = bodies.html;

    const result = await parseEmail(email, deps());
    res.json({ input: { from, subject: email.subject, headerDate: email.headerDate }, result });
  }),
);

/** Hot-reload the rules pack — the escape hatch that makes a broken template a data fix. */
debugRouter.post('/rules/reload', (_req, res) => {
  const pack = loadRulesPack(true);
  const merchantRules = repo.seedMerchantRules(pack);
  repo.seedCategories(pack.categories);
  res.json({
    version: pack.version,
    senders: pack.senders.length,
    merchants: Object.keys(pack.merchants).length,
    merchantRulesSeeded: merchantRules,
  });
});

debugRouter.get('/rules', (_req, res) => {
  const pack = loadRulesPack();
  res.json({
    version: pack.version,
    schemaVersion: pack.schemaVersion,
    parserVersion: PARSER_VERSION,
    senders: pack.senders.map((s) => ({
      id: s.id,
      issuer: s.issuer,
      kind: s.kind,
      addresses: s.addresses,
      templates: s.templates.map((t) => ({ id: t.id, confidence: t.confidence, pattern: t.source })),
    })),
    merchantCount: Object.keys(pack.merchants).length,
    categories: pack.categories,
  });
});
