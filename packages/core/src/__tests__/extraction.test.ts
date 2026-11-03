import { describe, expect, it } from 'vitest';
import { htmlToDocument, plainTextToDocument, truncateForModel } from '../parsing/html.js';
import { extractFromJsonLd } from '../parsing/jsonld.js';
import { chooseTransactionDate, findDates, parseWithFormat } from '../parsing/dates.js';
import { redactForModel } from '../parsing/redact.js';
import { subjectShape } from '../parsing/pipeline.js';
import { subjectSurvivesTriage, tier1Queries, tier2Query, SENDERS_PER_QUERY } from '../gmail/queries.js';
import { decodeBase64Url, extractBodies, headerValue, parseAddress } from '../gmail/mime.js';
import { loadRulesPack } from './helpers.js';

describe('html to text', () => {
  it('drops scripts and styles but keeps content', () => {
    const doc = htmlToDocument('<style>.a{color:red}</style><p>Total ₹100.00</p><script>var x=1</script>');
    expect(doc.text).toContain('Total ₹100.00');
    expect(doc.text).not.toContain('color:red');
    expect(doc.text).not.toContain('var x');
  });

  it('joins table cells so a label stays near its value', () => {
    const doc = htmlToDocument('<table><tr><td>Grand Total</td><td>₹613.00</td></tr></table>');
    expect(doc.text.replace(/\s+/g, ' ')).toContain('Grand Total | ₹613.00');
    expect(doc.tableRows[0]).toEqual(['Grand Total', '₹613.00']);
  });

  it('records bold and large-font ranges', () => {
    const doc = htmlToDocument('<p>Subtotal ₹10.00</p><p><b>Total ₹20.00</b></p>');
    expect(doc.emphasis.length).toBeGreaterThan(0);
    const boldText = doc.text.slice(doc.emphasis[0]!.start, doc.emphasis[0]!.end);
    expect(boldText).toContain('Total');
  });

  it('decodes entities', () => {
    expect(htmlToDocument('<p>Caf&eacute; &amp; Co &#8377;50</p>').text).toContain('Café & Co');
  });

  it('survives malformed markup', () => {
    expect(() => htmlToDocument('<div><p>unclosed <b>bold')).not.toThrow();
  });

  it('truncates for the model budget', () => {
    expect(truncateForModel('x'.repeat(10_000), 100)).toHaveLength(400 + '\n…[truncated]'.length);
  });

  it('normalizes plain text without destroying line structure', () => {
    expect(plainTextToDocument('a\r\n\r\n\r\n\r\nb').text).toBe('a\n\nb');
  });
});

describe('json-ld extraction', () => {
  it('reads an Order block', () => {
    const result = extractFromJsonLd(
      ['{"@type":"Order","priceCurrency":"INR","price":"1249.00","merchant":{"name":"Flipkart"},"orderDate":"2026-09-01"}'],
      'INR',
    );
    expect(result?.minorUnits).toBe(124900);
    expect(result?.merchant).toBe('Flipkart');
    expect(result?.occurredAt?.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('reads a nested Invoice total', () => {
    const result = extractFromJsonLd(
      ['{"@type":"Invoice","provider":{"name":"Acme"},"totalPaymentDue":{"@type":"PriceSpecification","price":"49.99","priceCurrency":"USD"}}'],
      'INR',
    );
    expect(result?.minorUnits).toBe(4999);
    expect(result?.currency).toBe('USD');
  });

  it('ignores unparseable blocks instead of throwing', () => {
    expect(extractFromJsonLd(['{not json'], 'INR')).toBeNull();
  });
});

describe('date extraction', () => {
  it('finds numeric, month-name and ISO dates', () => {
    expect(findDates('paid on 03-09-2026').length).toBeGreaterThan(0);
    expect(findDates('paid on 03-Sep-26').length).toBeGreaterThan(0);
    expect(findDates('paid on 2026-09-03')[0]?.date.getUTCMonth()).toBe(8);
  });

  it('disambiguates day/month by locale and by value', () => {
    expect(findDates('13/09/2026', 'en-IN')[0]?.date.getUTCDate()).toBe(13);
    expect(findDates('09/13/2026', 'en-US')[0]?.date.getUTCDate()).toBe(13);
  });

  it('parses with a template format hint', () => {
    expect(parseWithFormat('03-09-26', 'DD-MM-YY')?.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(parseWithFormat('Sep 3, 2026', 'MMM DD, YYYY')?.toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  it('prefers a body date near the amount over the header date', () => {
    const headerDate = new Date('2026-09-10T08:00:00Z');
    const chosen = chooseTransactionDate({
      text: 'Transaction of Rs 500 on 05-09-2026 at STARBUCKS',
      headerDate,
      anchorIndex: 16,
    });
    expect(chosen.date.toISOString().slice(0, 10)).toBe('2026-09-05');
    expect(chosen.source).not.toBe('header');
  });

  it('falls back to the header when the body has no usable date', () => {
    const headerDate = new Date('2026-09-10T08:00:00Z');
    expect(chooseTransactionDate({ text: 'Total Rs 500', headerDate }).source).toBe('header');
  });

  it('rejects far-future dates such as delivery estimates', () => {
    const headerDate = new Date('2026-09-10T08:00:00Z');
    const chosen = chooseTransactionDate({ text: 'Arriving 25-12-2026. Paid Rs 500', headerDate });
    expect(chosen.source).toBe('header');
  });
});

describe('redaction before the remote model', () => {
  it('removes account numbers, cards, emails, links and names', () => {
    const out = redactForModel(
      'Dear Alex Johnson, card 4023 5512 8841 7761 was charged. A/c no: 998877. See https://bank.com/t?tok=abc or mail me@x.com',
    );
    expect(out).not.toContain('4023 5512 8841 7761');
    expect(out).not.toContain('me@x.com');
    expect(out).not.toContain('tok=abc');
    expect(out).toContain('[name]');
  });

  it('keeps the amount, which is the whole point of the call', () => {
    expect(redactForModel('Rs 1,24,999.00 was debited')).toContain('1,24,999.00');
  });
});

describe('failure telemetry is content-free', () => {
  it('reduces a subject to its shape', () => {
    expect(subjectShape('Rs 450 debited from HDFC')).toBe('Cur-Num-Word-Word-Word');
  });
});

describe('gmail query construction', () => {
  const pack = loadRulesPack();

  it('chunks the allowlist so q stays under the length ceiling', () => {
    const many = Array.from({ length: 60 }, (_, i) => `sender${i}@example.com`);
    const queries = tier1Queries(pack, many, 35);
    expect(queries.length).toBeGreaterThan(1);
    for (const q of queries) {
      expect(q.split(' OR ').length).toBeLessThanOrEqual(SENDERS_PER_QUERY);
      expect(q).toContain('newer_than:35d');
    }
  });

  it('builds a discovery sweep that excludes promotions and social', () => {
    const q = tier2Query(pack, 35);
    expect(q).toContain('-category:promotions');
    expect(q).toContain('-in:spam');
    expect(q).toContain('subject:');
  });

  it('triages subjects for unknown senders only', () => {
    expect(subjectSurvivesTriage('Your monthly newsletter', false)).toBe(false);
    expect(subjectSurvivesTriage('Your monthly newsletter', true)).toBe(true);
    expect(subjectSurvivesTriage('Receipt for your order', false)).toBe(true);
  });
});

describe('gmail mime handling', () => {
  it('decodes the URL-safe base64 alphabet', () => {
    const encoded = Buffer.from('Total ₹1,249.00 — paid?').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Total ₹1,249.00 — paid?');
  });

  it('walks multipart payloads preferring text/plain', () => {
    const bodies = extractBodies({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('plain body').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from('<p>html body</p>').toString('base64url') } },
      ],
    });
    expect(bodies.text).toBe('plain body');
    expect(bodies.html).toBe('<p>html body</p>');
  });

  it('reads headers and addresses', () => {
    const part = { headers: [{ name: 'From', value: 'HDFC Bank <alerts@hdfcbank.net>' }] };
    expect(headerValue(part, 'from')).toContain('hdfcbank.net');
    expect(parseAddress(headerValue(part, 'From'))).toBe('alerts@hdfcbank.net');
  });
});
