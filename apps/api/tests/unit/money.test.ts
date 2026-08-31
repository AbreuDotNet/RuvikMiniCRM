import { describe, it, expect } from 'vitest';
import { computeLine, computeTotals, formatMoney } from '../../src/lib/money.js';

describe('money: line calculation', () => {
  it('multiplies quantity by unit price in integer cents', () => {
    const line = computeLine({ description: 'x', quantity: 3, unitPriceCents: 1250, taxRateBp: 0 });
    expect(line.lineSubtotalCents).toBe(3750);
    expect(line.lineTaxCents).toBe(0);
    expect(line.lineTotalCents).toBe(3750);
  });

  it('handles fractional quantities such as billable hours', () => {
    const line = computeLine({ description: 'labour', quantity: 2.5, unitPriceCents: 4500, taxRateBp: 0 });
    expect(line.lineSubtotalCents).toBe(11250);
  });

  it('applies tax in basis points', () => {
    const line = computeLine({ description: 'x', quantity: 1, unitPriceCents: 10000, taxRateBp: 825 });
    expect(line.lineTaxCents).toBe(825);
    expect(line.lineTotalCents).toBe(10825);
  });

  it('rounds half up rather than truncating, so cents are never lost', () => {
    // 0.5 cents of tax must round to 1, not 0.
    const line = computeLine({ description: 'x', quantity: 1, unitPriceCents: 1, taxRateBp: 5000 });
    expect(line.lineTaxCents).toBe(1);
  });

  it('never produces a fractional cent', () => {
    const line = computeLine({ description: 'x', quantity: 1.333, unitPriceCents: 999, taxRateBp: 1234 });
    expect(Number.isInteger(line.lineSubtotalCents)).toBe(true);
    expect(Number.isInteger(line.lineTaxCents)).toBe(true);
    expect(Number.isInteger(line.lineTotalCents)).toBe(true);
  });
});

describe('money: document totals', () => {
  const lines = [
    { description: 'Part', quantity: 1, unitPriceCents: 12000, taxRateBp: 825 },
    { description: 'Labour', quantity: 2, unitPriceCents: 4500, taxRateBp: 825 },
  ];

  it('sums subtotal, tax and total', () => {
    const totals = computeTotals(lines);
    expect(totals.subtotalCents).toBe(21000);
    expect(totals.taxCents).toBe(1733);
    expect(totals.totalCents).toBe(22733);
  });

  it('reduces the taxable base proportionally when a discount applies', () => {
    // A 50% discount must halve the tax, not leave the customer taxed on
    // money they did not pay.
    const totals = computeTotals(lines, 10500);
    expect(totals.discountCents).toBe(10500);
    expect(totals.taxCents).toBe(866);
    expect(totals.totalCents).toBe(11366);
  });

  it('caps a discount at the subtotal so a total can never go negative', () => {
    const totals = computeTotals(lines, 999_999);
    expect(totals.discountCents).toBe(21000);
    expect(totals.totalCents).toBe(0);
  });

  it('ignores a negative discount', () => {
    const totals = computeTotals(lines, -5000);
    expect(totals.discountCents).toBe(0);
    expect(totals.totalCents).toBe(22733);
  });

  it('returns zeroes for an empty document', () => {
    const totals = computeTotals([]);
    expect(totals).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });

  it('keeps totals equal to the sum of its lines', () => {
    const totals = computeTotals(lines);
    const sum = totals.lines.reduce((s, l) => s + l.lineTotalCents, 0);
    expect(sum).toBe(totals.subtotalCents + totals.taxCents);
  });
});

describe('money: formatting', () => {
  it('formats cents as currency', () => {
    expect(formatMoney(27_435, 'USD')).toBe('$274.35');
  });

  it('groups thousands', () => {
    expect(formatMoney(1_234_567, 'USD')).toBe('$12,345.67');
  });

  it('formats a whole-dollar amount', () => {
    expect(formatMoney(12000, 'USD')).toBe('$120.00');
  });
});
