/**
 * L1 — schema.org / JSON-LD extraction (§3).
 *
 * Large merchants embed Order / Invoice / ParcelDelivery markup for Gmail's own annotations.
 * When present it is exact typed data, so it is checked before any regex runs.
 */
import { parseAmountString } from './money.js';

export interface JsonLdExtraction {
  minorUnits: number;
  currency: string;
  merchant?: string;
  occurredAt?: Date;
  orderNumber?: string;
  type: string;
}

type Json = Record<string, unknown>;

function typesOf(node: Json): string[] {
  const t = node['@type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function flatten(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 8 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out, depth + 1);
    return out;
  }
  const obj = node as Json;
  out.push(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') flatten(value, out, depth + 1);
  }
  return out;
}

function nameOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const name = (value as Json).name;
    if (typeof name === 'string') return name;
    if (Array.isArray(value) && value.length > 0) return nameOf(value[0]);
  }
  return undefined;
}

function priceFrom(node: Json): { price: string; currency?: string } | null {
  const direct = node.price ?? node.totalPrice;
  if (typeof direct === 'string' || typeof direct === 'number') {
    const currency = node.priceCurrency;
    return { price: String(direct), ...(typeof currency === 'string' ? { currency } : {}) };
  }
  for (const key of ['totalPaymentDue', 'priceSpecification', 'totalPrice', 'paymentDue']) {
    const nested = node[key];
    if (nested && typeof nested === 'object') {
      const inner = priceFrom(nested as Json);
      if (inner) return inner;
    }
  }
  return null;
}

function dateFrom(node: Json): Date | undefined {
  for (const key of ['orderDate', 'paymentDueDate', 'datePaid', 'dateCreated', 'startTime']) {
    const value = node[key];
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return undefined;
}

const INTERESTING = new Set(['Order', 'Invoice', 'ParcelDelivery', 'FlightReservation', 'LodgingReservation', 'FoodEstablishmentReservation']);

export function extractFromJsonLd(blocks: string[], defaultCurrency: string): JsonLdExtraction | null {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      // Some senders emit JSON-LD with trailing commas or HTML comments wrapped around it.
      const cleaned = block.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        continue;
      }
    }

    const nodes = flatten(parsed);
    // Prefer the node that actually carries a price and an interesting type.
    const ranked = nodes
      .map((node) => ({ node, types: typesOf(node) }))
      .sort((a, b) => {
        const aScore = a.types.some((t) => INTERESTING.has(t)) ? 1 : 0;
        const bScore = b.types.some((t) => INTERESTING.has(t)) ? 1 : 0;
        return bScore - aScore;
      });

    for (const { node, types } of ranked) {
      const price = priceFrom(node);
      if (!price) continue;
      const currency = (price.currency ?? defaultCurrency).toUpperCase();
      const amount = parseAmountString(String(price.price).replace(/[^\d.,]/g, ''), currency, 'en-US');
      if (!amount || amount.minorUnits <= 0) continue;

      const merchant =
        nameOf(node.merchant) ??
        nameOf(node.seller) ??
        nameOf(node.provider) ??
        nameOf(node.broker) ??
        nameOf((node.partOfOrder as Json | undefined)?.merchant);

      const result: JsonLdExtraction = {
        minorUnits: amount.minorUnits,
        currency,
        type: types[0] ?? 'Thing',
      };
      if (merchant) result.merchant = merchant;
      const date = dateFrom(node);
      if (date) result.occurredAt = date;
      const orderNumber = node.orderNumber ?? node.confirmationNumber;
      if (typeof orderNumber === 'string') result.orderNumber = orderNumber;
      return result;
    }
  }
  return null;
}
