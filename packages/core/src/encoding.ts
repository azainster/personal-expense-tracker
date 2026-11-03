/**
 * Byte and text encodings without Buffer, TextDecoder or TextEncoder.
 *
 * This package runs on Node and inside React Native's Hermes engine, where none of those
 * are guaranteed. Gmail hands back message parts as URL-safe base64 in the part's own
 * charset, so decoding needs both a base64 reader and a charset-aware text decoder.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  // URL-safe alphabet (RFC 4648 §5), which Gmail uses.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

/** Decodes standard or URL-safe base64, with or without padding. */
export function base64ToBytes(input: string): Uint8Array {
  const out = new Uint8Array(Math.floor((input.length * 3) / 4) + 3);
  let buffer = 0;
  let bits = 0;
  let length = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    const value = code < 128 ? (LOOKUP[code] ?? -1) : -1;
    if (value < 0) continue; // padding, whitespace, line breaks
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length] = (buffer >> bits) & 0xff;
      length += 1;
    }
  }
  return out.subarray(0, length);
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[triple & 63];
  }
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
}

function codeUnitsToString(units: number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += 8192) {
    out += String.fromCharCode.apply(null, units.slice(i, i + 8192));
  }
  return out;
}

/** UTF-8 → string. Malformed sequences become U+FFFD, like Buffer#toString('utf8'). */
export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] as number;
    if (b0 < 0x80) {
      units.push(b0);
      i += 1;
      continue;
    }
    let needed = 0;
    let codePoint = 0;
    let min = 0;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      needed = 1;
      codePoint = b0 & 0x1f;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      needed = 2;
      codePoint = b0 & 0x0f;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      needed = 3;
      codePoint = b0 & 0x07;
      min = 0x10000;
    } else {
      units.push(0xfffd);
      i += 1;
      continue;
    }
    let valid = i + needed <= bytes.length - 1;
    let j = 1;
    for (; valid && j <= needed; j += 1) {
      const next = bytes[i + j] as number;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (!valid || codePoint < min || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      units.push(0xfffd);
      i += Math.max(1, j);
      continue;
    }
    if (codePoint >= 0x10000) {
      const offset = codePoint - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(codePoint);
    }
    i += needed + 1;
  }
  return codeUnitsToString(units);
}

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Windows-1252 differs from Latin-1 only in 0x80–0x9F. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** Decodes bytes in the charset a MIME part declares. Unknown charsets fall back to UTF-8. */
export function decodeBytes(bytes: Uint8Array, charset?: string | null): string {
  const cs = (charset ?? 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '');
  if (cs === 'iso-8859-1' || cs === 'latin1' || cs === 'us-ascii' || cs === 'ascii' || cs === 'windows-1252' || cs === 'cp1252') {
    const useCp1252 = cs === 'windows-1252' || cs === 'cp1252' || cs === 'iso-8859-1' || cs === 'latin1';
    const units: number[] = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i] as number;
      units[i] = useCp1252 && b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b] ?? b) : b;
    }
    return codeUnitsToString(units);
  }
  return utf8Decode(bytes);
}
