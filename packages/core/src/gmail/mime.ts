/**
 * Gmail MIME handling (§2, Step 2 of the roadmap).
 *
 * Gmail encodes part bodies with the URL-safe base64 alphabet — a standard base64 decode
 * fails on `-` and `_`. The bytes are in the part's declared charset, which is honoured
 * here (a Latin-1 bank alert decoded as UTF-8 turns `₹`-free amounts into mojibake around
 * them). The walker prefers `text/plain` and falls back to `text/html`.
 */
import { base64ToBytes, decodeBytes } from '../encoding.js';

export interface GmailMessagePartBody {
  size?: number;
  data?: string;
  attachmentId?: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
}

export function decodeBase64Url(data: string, charset?: string | null): string {
  return decodeBytes(base64ToBytes(data), charset);
}

export function headerValue(part: GmailMessagePart | undefined, name: string): string {
  const target = name.toLowerCase();
  const header = part?.headers?.find((h) => h.name.toLowerCase() === target);
  return header?.value ?? '';
}

/** `text/html; charset="ISO-8859-1"` → `iso-8859-1`. */
export function charsetOf(part: GmailMessagePart): string | null {
  const contentType = headerValue(part, 'Content-Type');
  const match = contentType.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}

/** Extracts the address from a `Display Name <addr@example.com>` header. */
export function parseAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  if (angled?.[1]) return angled[1].trim().toLowerCase();
  const bare = from.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return (bare?.[0] ?? from).trim().toLowerCase();
}

/** `"HDFC Bank" <alerts@hdfcbank.net>` → `HDFC Bank`. Falls back to the address. */
export function parseDisplayName(from: string): string {
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return name !== '' ? name : parseAddress(from);
}

export interface MessageBodies {
  text?: string;
  html?: string;
}

/** Depth-first walk collecting the first text/plain and text/html parts. */
export function extractBodies(payload: GmailMessagePart | undefined): MessageBodies {
  const bodies: MessageBodies = {};
  if (!payload) return bodies;

  const visit = (part: GmailMessagePart, depth: number): void => {
    if (depth > 12) return;
    const mime = (part.mimeType ?? '').toLowerCase();
    const data = part.body?.data;
    if (data && !part.filename) {
      const charset = charsetOf(part);
      if (mime === 'text/plain' && bodies.text === undefined) bodies.text = decodeBase64Url(data, charset);
      else if (mime === 'text/html' && bodies.html === undefined) bodies.html = decodeBase64Url(data, charset);
      else if (mime === '' && bodies.text === undefined) bodies.text = decodeBase64Url(data, charset);
    }
    for (const child of part.parts ?? []) visit(child, depth + 1);
  };

  visit(payload, 0);
  return bodies;
}

export function parseInternalDate(message: GmailMessage): Date {
  if (message.internalDate) {
    const ms = Number(message.internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  }
  const header = headerValue(message.payload, 'Date');
  if (header) {
    const parsed = new Date(header);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
