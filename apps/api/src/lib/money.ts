/**
 * All monetary arithmetic happens in integer minor units (cents).
 * Rounding is half-up at the line level, which is what invoicing software
 * and tax authorities expect.
 */
export interface LineInput {
  description: string;
  quantity: number;      // may be fractional (e.g. 1.5 hours)
  unitPriceCents: number;
  taxRateBp: number;     // basis points: 1800 = 18%
}

export interface LineTotals extends LineInput {
  lineSubtotalCents: number;
  lineTaxCents: number;
  lineTotalCents: number;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

export function computeLine(line: LineInput): LineTotals {
  const lineSubtotalCents = roundHalfUp(line.quantity * line.unitPriceCents);
  const lineTaxCents = roundHalfUp((lineSubtotalCents * line.taxRateBp) / 10_000);
  return {
    ...line,
    lineSubtotalCents,
    lineTaxCents,
    lineTotalCents: lineSubtotalCents + lineTaxCents,
  };
}

/**
 * A discount is applied to the subtotal and reduces the taxable base
 * proportionally, so tax is never charged on money the customer did not pay.
 */
export function computeTotals(inputs: LineInput[], discountCents = 0): DocumentTotals {
  const lines = inputs.map(computeLine);
  const subtotalCents = lines.reduce((s, l) => s + l.lineSubtotalCents, 0);
  const discount = Math.min(Math.max(discountCents, 0), subtotalCents);

  const ratio = subtotalCents === 0 ? 0 : (subtotalCents - discount) / subtotalCents;
  const taxCents = lines.reduce((s, l) => s + roundHalfUp(l.lineTaxCents * ratio), 0);

  return {
    lines,
    subtotalCents,
    discountCents: discount,
    taxCents,
    totalCents: subtotalCents - discount + taxCents,
  };
}

export function formatMoney(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
