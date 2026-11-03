/**
 * Fixed-window, in-memory rate limiting per client IP for the public /api/v1 endpoints.
 * Enough to stop one install (or one abuser) from running up the Anthropic bill; put a real
 * limiter at the edge if this is ever deployed to more than one instance.
 */
import type { NextFunction, Request, Response } from 'express';

export function rateLimit(options: { windowMs: number; max: () => number; name: string }) {
  const hits = new Map<string, { count: number; windowStart: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.windowStart > options.windowMs) hits.delete(k);
    }

    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > options.windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > options.max()) {
      const retryAfter = Math.ceil((entry.windowStart + options.windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      res.status(429).json({ error: { code: 'rate_limited', message: `Too many ${options.name} requests. Try again later.` } });
      return;
    }
    next();
  };
}
