import { describe, expect, it } from 'vitest';
import { formatMinor, majorUnits, minorUnitExponent, parseAmountString, toMinorUnits } from '../parsing/money.js';

describe('parseAmountString', () => {
  it('parses plain decimals', () => {
    expect(parseAmountString('1249.00', 'INR')?.minorUnits).toBe(124900);
    expect(parseAmountString('54.20', 'USD')?.minorUnits).toBe(5420);
    expect(parseAmountString('2.99', 'USD')?.minorUnits).toBe(299);
  });

  it('parses Indian grouping, not just 3-digit groups', () => {
    expect(parseAmountString('1,23,456.78', 'INR')?.minorUnits).toBe(12345678);
    expect(parseAmountString('1,24,999.00', 'INR')?.minorUnits).toBe(12499900);
    expect(parseAmountString('99,999', 'INR')?.minorUnits).toBe(9999900);
  });

  it('parses European separators', () => {
    expect(parseAmountString('1.234,56', 'EUR')?.minorUnits).toBe(123456);
    expect(parseAmountString('1.100,00', 'EUR')?.minorUnits).toBe(110000);
    expect(parseAmountString('134,56', 'EUR')?.minorUnits).toBe(13456);
  });

  it('resolves the 1.234 ambiguity by group size', () => {
    // Three trailing digits after a lone separator is grouping, not a 3-decimal amount.
    expect(parseAmountString('1.234', 'USD')).toEqual({ minorUnits: 123400, interpretation: 'grouping-only' });
    expect(parseAmountString('1,234', 'USD')).toEqual({ minorUnits: 123400, interpretation: 'grouping-only' });
    // …unless the currency genuinely has three minor digits.
    expect(parseAmountString('1.234', 'KWD')).toEqual({ minorUnits: 1234, interpretation: 'decimal' });
  });

  it('honours currencies whose exponent is not 2', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('BHD')).toBe(3);
    expect(parseAmountString('1,250', 'JPY')?.minorUnits).toBe(1250);
  });

  it('rounds half-up when more precision is given than the currency has', () => {
    expect(parseAmountString('10.0050', 'USD')?.minorUnits).toBe(1001);
    expect(parseAmountString('10.0049', 'USD')?.minorUnits).toBe(1000);
  });

  it('pins the documented group-size heuristic', () => {
    // "10.005" has exactly three trailing digits after a lone separator, so it is read as
    // grouping (10,005) rather than as a three-decimal amount. This is the rule §3 asks for.
    expect(parseAmountString('10.005', 'USD')?.minorUnits).toBe(1000500);
  });

  it('rejects things that are not amounts', () => {
    expect(parseAmountString('', 'INR')).toBeNull();
    expect(parseAmountString('abc', 'INR')).toBeNull();
    expect(parseAmountString('12-34', 'INR')).toBeNull();
  });

  it('round-trips through minor units without float drift', () => {
    const total = [0.1, 0.2].reduce((sum, v) => sum + toMinorUnits(v, 'USD'), 0);
    expect(total).toBe(30);
    expect(majorUnits(total, 'USD')).toBe(0.3);
  });

  it('formats for display', () => {
    expect(formatMinor(124900, 'INR', 'en-IN')).toContain('1,249.00');
    expect(formatMinor(5420, 'USD', 'en-US')).toBe('$54.20');
  });
});
