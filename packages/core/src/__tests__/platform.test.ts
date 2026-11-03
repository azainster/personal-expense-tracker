/**
 * This package ships inside the iPhone app, where Buffer, TextDecoder, node:crypto and a
 * spec-complete URL are not available. These tests pin the pure-JS replacements to Node's
 * behaviour, and fail the build if runtime code reaches for a Node-only global.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeBytes, utf8Decode, utf8Encode } from '../encoding.js';
import { sha256Hex } from '../sha256.js';
import { buildQueryString } from '../gmail/client.js';
import { extractBodies } from '../gmail/mime.js';

const SAMPLES = [
  '',
  'a',
  'Total ₹1,249.00 — paid?',
  'Café & Co 😀 𝄞 日本語',
  'x'.repeat(55),
  'y'.repeat(56),
  'z'.repeat(64),
  'Rs.1,23,456.78 has been debited\r\n'.repeat(80),
];

describe('encoding', () => {
  it('round-trips UTF-8 exactly like Buffer', () => {
    for (const sample of SAMPLES) {
      const bytes = utf8Encode(sample);
      expect(Buffer.from(bytes).equals(Buffer.from(sample, 'utf8'))).toBe(true);
      expect(utf8Decode(bytes)).toBe(sample);
    }
  });

  it('decodes standard and URL-safe base64 like Buffer', () => {
    for (const sample of SAMPLES) {
      const buf = Buffer.from(sample, 'utf8');
      expect(utf8Decode(base64ToBytes(buf.toString('base64')))).toBe(sample);
      expect(utf8Decode(base64ToBytes(buf.toString('base64url')))).toBe(sample);
      expect(bytesToBase64(new Uint8Array(buf))).toBe(buf.toString('base64'));
      expect(bytesToBase64(new Uint8Array(buf), true)).toBe(buf.toString('base64url'));
    }
  });

  it('replaces malformed UTF-8 with U+FFFD instead of throwing', () => {
    expect(utf8Decode(new Uint8Array([0x41, 0xff, 0x42]))).toBe('A�B');
    expect(utf8Decode(new Uint8Array([0x41, 0xe2, 0x82]))).toContain('A');
  });

  it('honours Latin-1 / Windows-1252 charsets', () => {
    const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35]); // "Café €5"
    expect(decodeBytes(bytes, 'windows-1252')).toBe('Café €5');
    expect(decodeBytes(bytes, 'ISO-8859-1')).toBe('Café €5');
  });

  it('decodes a Gmail part in its declared charset', () => {
    const latin1 = Buffer.from([0x54, 0x6f, 0x74, 0x61, 0x6c, 0x20, 0xa3, 0x31, 0x32]).toString('base64url'); // "Total £12"
    const bodies = extractBodies({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: latin1 },
    });
    expect(bodies.text).toBe('Total £12');
  });
});

describe('sha256', () => {
  it('matches node:crypto byte for byte', () => {
    for (const sample of SAMPLES) {
      expect(sha256Hex(sample)).toBe(createHash('sha256').update(sample, 'utf8').digest('hex'));
    }
  });
});

describe('query strings', () => {
  it('encodes repeated keys the way URLSearchParams parses them', () => {
    const qs = buildQueryString({ format: 'metadata', metadataHeaders: ['From', 'Subject'], q: 'from:(a@b.com OR c@d.in) newer_than:35d' });
    const parsed = new URLSearchParams(qs);
    expect(parsed.getAll('metadataHeaders')).toEqual(['From', 'Subject']);
    expect(parsed.get('q')).toBe('from:(a@b.com OR c@d.in) newer_than:35d');
  });
});

describe('portability guard', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__' && name !== 'tools') walk(full);
      } else if (name.endsWith('.ts')) {
        files.push(full);
      }
    }
  };
  walk(srcDir);

  const FORBIDDEN: Array<[RegExp, string]> = [
    [/\bBuffer\b/, 'Buffer'],
    [/\bprocess\./, 'process'],
    [/from ['"]node:/, 'node: import'],
    [/\brequire\(/, 'require()'],
    [/new URL\(/, 'URL'],
    [/\bURLSearchParams\b/, 'URLSearchParams'],
    [/\bTextDecoder\b/, 'TextDecoder'],
    [/\bTextEncoder\b/, 'TextEncoder'],
    [/\bcrypto\./, 'crypto global'],
  ];

  it('scans the runtime sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(`${file.slice(srcDir.length)} uses no Node-only globals`, () => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      for (const [pattern, label] of FORBIDDEN) {
        expect(pattern.test(code), `${label} in ${file}`).toBe(false);
      }
    });
  }
});
