/**
 * HTML → text conversion.
 *
 * §6 of the architecture: "Don't regex raw HTML. Strip to text first with a real parser;
 * keep a DOM path for table-structured receipts."
 *
 * Two things beyond a naive strip matter for extraction quality:
 *  - table cells are joined with " | " so a `<td>Total</td><td>₹1,249</td>` pair stays
 *    inside the ±60 character scoring window used by the L2 candidate scorer;
 *  - bold / large-font ranges are recorded so typographic emphasis can score.
 */
import { parse, type HTMLElement, type Node } from 'node-html-parser';

export interface EmphasisRange {
  start: number;
  end: number;
  weight: number;
}

export interface ExtractedDocument {
  text: string;
  emphasis: EmphasisRange[];
  jsonLdBlocks: string[];
  /** Table rows as cell arrays — lets a receipt's "label, value" structure be read directly. */
  tableRows: string[][];
}

const SKIP_TAGS = new Set(['style', 'meta', 'link', 'noscript', 'svg', 'title']);
const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'tr', 'li', 'ul', 'ol', 'table', 'tbody', 'thead', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'section', 'article', 'header', 'footer', 'blockquote', 'hr', 'center',
]);
const CELL_TAGS = new Set(['td', 'th']);
const BOLD_TAGS = new Set(['b', 'strong', 'th', 'h1', 'h2', 'h3']);

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;

function fontWeightFromStyle(style: string | undefined): number {
  if (!style) return 0;
  const lower = style.toLowerCase();
  let weight = 0;
  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(lower)) weight += 1;
  const size = lower.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|pt|em|rem)/);
  if (size) {
    const value = Number(size[1]);
    const unit = size[2];
    const px = unit === 'px' ? value : unit === 'pt' ? value * 1.333 : value * 16;
    if (px >= 18) weight += 1;
    if (px >= 24) weight += 1;
  }
  return weight;
}

/** Converts an HTML email body into plain text plus structural metadata. */
export function htmlToDocument(html: string): ExtractedDocument {
  let root: HTMLElement;
  try {
    root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  } catch {
    return { text: stripTagsFallback(html), emphasis: [], jsonLdBlocks: [], tableRows: [] };
  }

  const out: string[] = [];
  const emphasis: EmphasisRange[] = [];
  const jsonLdBlocks: string[] = [];
  const tableRows: string[][] = [];
  let length = 0;

  const push = (chunk: string, weight: number): void => {
    if (chunk === '') return;
    if (weight > 0) emphasis.push({ start: length, end: length + chunk.length, weight });
    out.push(chunk);
    length += chunk.length;
  };

  const walk = (node: Node, weight: number, row: string[] | null): void => {
    if (node.nodeType === NODE_TEXT) {
      const raw = (node as unknown as { text: string }).text ?? '';
      const cleaned = raw.replace(/[\s ]+/g, ' ');
      if (cleaned.trim() === '') {
        if (cleaned !== '' && !/\s$/.test(out[out.length - 1] ?? ' ')) push(' ', 0);
        return;
      }
      push(cleaned, weight);
      if (row) row.push(cleaned.trim());
      return;
    }
    if (node.nodeType !== NODE_ELEMENT) return;

    const el = node as HTMLElement;
    const tag = (el.rawTagName ?? '').toLowerCase();

    if (tag === 'script') {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type.includes('ld+json')) jsonLdBlocks.push(el.textContent ?? el.innerHTML ?? '');
      return;
    }
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'head') {
      // Descend for JSON-LD only — schema.org blocks usually live here, and skipping the
      // whole <head> is why they get missed.
      for (const child of el.childNodes) {
        if (child.nodeType === NODE_ELEMENT && (child as HTMLElement).rawTagName?.toLowerCase() === 'script') {
          walk(child, weight, null);
        }
      }
      return;
    }

    if (tag === 'br' || tag === 'hr') {
      push('\n', 0);
      return;
    }

    const childWeight = weight + (BOLD_TAGS.has(tag) ? 1 : 0) + fontWeightFromStyle(el.getAttribute('style'));

    if (tag === 'tr') {
      const cells: string[] = [];
      push('\n', 0);
      for (const child of el.childNodes) walk(child, childWeight, cells);
      if (cells.length > 0) tableRows.push(cells);
      push('\n', 0);
      return;
    }

    if (CELL_TAGS.has(tag)) {
      const before = length;
      for (const child of el.childNodes) walk(child, childWeight, row);
      if (length > before) push(' | ', 0);
      return;
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) push('\n', 0);
    for (const child of el.childNodes) walk(child, childWeight, row);
    if (isBlock) push('\n', 0);
  };

  for (const child of root.childNodes) walk(child, 0, null);

  const joined = out.join('');
  const { text, map } = collapse(joined);
  const remapped = emphasis
    .map((range) => ({
      start: map(range.start),
      end: map(range.end),
      weight: range.weight,
    }))
    .filter((r) => r.end > r.start);

  return { text, emphasis: remapped, jsonLdBlocks, tableRows };
}

/** Collapses runs of whitespace while keeping an index map from the pre-collapse string. */
function collapse(input: string): { text: string; map: (index: number) => number } {
  const offsets = new Int32Array(input.length + 1);
  let out = '';
  let pendingNewlines = 0;
  let pendingSpace = false;

  for (let i = 0; i < input.length; i += 1) {
    offsets[i] = out.length;
    const ch = input[i] as string;
    if (ch === '\n') {
      pendingNewlines = Math.min(pendingNewlines + 1, 2);
      pendingSpace = false;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pendingSpace = true;
      continue;
    }
    if (pendingNewlines > 0) {
      out += '\n'.repeat(out === '' ? 0 : pendingNewlines);
      pendingNewlines = 0;
      pendingSpace = false;
    } else if (pendingSpace) {
      if (out !== '') out += ' ';
      pendingSpace = false;
    }
    offsets[i] = out.length;
    out += ch;
  }
  offsets[input.length] = out.length;

  return {
    text: out.trim(),
    map: (index: number) => {
      const clamped = Math.max(0, Math.min(index, input.length));
      const trimmedLead = out.length - out.trimStart().length;
      return Math.max(0, (offsets[clamped] ?? 0) - trimmedLead);
    },
  };
}

function stripTagsFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Normalizes a text/plain body the same way so downstream stages see one shape. */
export function plainTextToDocument(text: string): ExtractedDocument {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[  ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: normalized, emphasis: [], jsonLdBlocks: [], tableRows: [] };
}

/** Truncates to a token budget before handing text to an LLM (≈4 chars per token). */
export function truncateForModel(text: string, maxTokens = 1500): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}
