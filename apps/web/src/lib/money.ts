/**
 * Mirror of the API's `lib/money.ts`, for the live preview.
 *
 * The preview has to be reached the same way the invoice is, or the provider
 * approves one total and a different one is stored, printed and emailed. The
 * two files used to disagree: the API rounded tax per line while the preview
 * rounded the aggregate, so a discount could shift the tax by a cent.
 *
 * `apps/api/tests/unit/moneyParity.test.ts` runs both over the same cases, so
 * editing one without the other fails the build. Keep them identical.
 */

export type TaxTreatment = 'taxable' | 'exempt' | 'not_subject';

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  taxTreatment?: TaxTreatment;
}

export interface LineTotals {
  lineSubtotalCents: number;
  lineDiscountCents: number;
  lineTaxableBaseCents: number;
  appliedTaxRateBp: number;
  lineTaxCents: number;
  lineTotalCents: number;
  taxTreatment: TaxTreatment;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxableBaseCents: number;
  untaxedBaseCents: number;
  taxCents: number;
  totalCents: number;
}

function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Largest remainder: the parts stay proportional and sum to exactly `amount`. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || amount === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amount * w) / total);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = amount - floors.reduce((s, v) => s + v, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out;
}

export function computeTotals(inputs: LineInput[], discountCents = 0): DocumentTotals {
  const subtotals = inputs.map((l) => roundHalfUp(l.quantity * l.unitPriceCents));
  const subtotalCents = subtotals.reduce((s, v) => s + v, 0);

  const discount = Math.min(Math.max(Math.trunc(discountCents), 0), subtotalCents);
  const shares = allocate(discount, subtotals);

  const lines: LineTotals[] = inputs.map((line, i) => {
    const taxTreatment: TaxTreatment = line.taxTreatment ?? 'taxable';
    const lineSubtotalCents = subtotals[i];
    const lineDiscountCents = shares[i];
    const lineTaxableBaseCents = lineSubtotalCents - lineDiscountCents;
    const appliedTaxRateBp = taxTreatment === 'taxable' ? line.taxRateBp : 0;
    const lineTaxCents = roundHalfUp((lineTaxableBaseCents * appliedTaxRateBp) / 10_000);

    return {
      taxTreatment,
      lineSubtotalCents,
      lineDiscountCents,
      lineTaxableBaseCents,
      appliedTaxRateBp,
      lineTaxCents,
      lineTotalCents: lineTaxableBaseCents + lineTaxCents,
    };
  });

  const taxCents = lines.reduce((s, l) => s + l.lineTaxCents, 0);
  const taxableBaseCents = lines
    .filter((l) => l.taxTreatment === 'taxable')
    .reduce((s, l) => s + l.lineTaxableBaseCents, 0);

  return {
    lines,
    subtotalCents,
    discountCents: discount,
    taxableBaseCents,
    untaxedBaseCents: subtotalCents - discount - taxableBaseCents,
    taxCents,
    totalCents: subtotalCents - discount + taxCents,
  };
}
