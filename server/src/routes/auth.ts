import { Router } from 'express';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { beginAuthorization, completeAuthorization, connectionStatus, disconnect, SCOPES } from '../gmail/oauth.js';
import { truncateAll } from '../db/index.js';
import { asyncHandler, requireString } from './helpers.js';

const log = createLogger('routes:auth');
export const authRouter = Router();

authRouter.get('/status', (_req, res) => {
  res.json({ ...connectionStatus(), scopes: SCOPES });
});

/** Starts the consent flow. The browser is redirected to Google. */
authRouter.get('/google/start', (_req, res) => {
  const { url } = beginAuthorization();
  res.redirect(url);
});

/** Same flow, but returns the URL for a fetch-based caller. */
authRouter.post('/google/url', (_req, res) => {
  res.json(beginAuthorization());
});

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const error = req.query.error;
    if (typeof error === 'string' && error !== '') {
      log.warn('oauth consent declined or failed', { error });
      res.redirect(`${config.webOrigin}/?connected=0&error=${encodeURIComponent(error)}`);
      return;
    }
    const code = requireString(req.query.code, 'code');
    const state = requireString(req.query.state, 'state');
    const { accountEmail } = await completeAuthorization(code, state);
    res.redirect(`${config.webOrigin}/?connected=1&account=${encodeURIComponent(accountEmail)}`);
  }),
);

/** Disconnect: revoke at Google, wipe the vault, and optionally wipe local data. */
authRouter.post(
  '/disconnect',
  asyncHandler(async (req, res) => {
    await disconnect();
    const wipeLocalData = (req.body as Record<string, unknown> | undefined)?.wipeLocalData === true;
    if (wipeLocalData) {
      truncateAll();
      log.info('local store wiped at user request');
    }
    res.json({ disconnected: true, wipedLocalData: wipeLocalData });
  }),
);
