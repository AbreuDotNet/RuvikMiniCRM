/**
 * All monetary arithmetic happens in integer minor units (cents).
 * Rounding is half away from zero, applied once per line.
 *
 * This module is the single definition of how a document's totals are reached.
 * The web app mirrors it for the live preview; `tests/unit/moneyParity.test.ts`
 * runs both implementations over the same cases so a divergence fails the
 * build instead of showing the provider one tax and invoicing another.
 */

/**
 * How a line is treated for sales tax.
 *
 * `exempt` and `not_subject` are not synonyms and must not be collapsed:
 * an exempt sale is within the tax's scope but relieved by an exemption the
 * seller has to be able to evidence (typically a certificate, which several
 * states require the seller to retain); a not-subject sale is outside the
 * scope to begin with — for example labor on residential real property in
 * Texas. Auditors ask which one applied, so the reason is stored per line.
 */
export type TaxTreatment = 'taxable' | 'exempt' | 'not_subject';

export interface LineInput {
  description: string;
  quantity: number;      // may be fractional (e.g. 1.5 hours)
  unitPriceCents: number;
  taxRateBp: number;     // basis points: 825 = 8.25%
  /** Defaults to 'taxable' so existing callers keep their behaviour. */
  taxTreatment?: TaxTreatment;
  /** Required by the API layer whenever the treatment is not 'taxable'. */
  taxReason?: string | null;
}

export interface LineTotals extends LineInput {
  taxTreatment: TaxTreatment;
  lineSubtotalCents: number;
  /** Share of the document discount allocated to this line. */
  lineDiscountCents: number;
  /** Subtotal after that share — the base the tax is charged on. */
  lineTaxableBaseCents: number;
  /** Rate actually applied: zero unless the treatment is 'taxable'. */
  appliedTaxRateBp: number;
  lineTaxCents: number;
  lineTotalCents: number;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  /** Portion of the discounted subtotal that sales tax was charged on. */
  taxableBaseCents: number;
  /** Portion carrying no tax, whether exempt or out of scope. */
  untaxedBaseCents: number;
  taxCents: number;
  totalCents: number;
}

/** Half away from zero, so -0.5 becomes -1 rather than -0. */
function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Splits `amount` across `weights` so the parts are proportional and sum to
 * exactly `amount`.
 *
 * Rounding each share independently loses or invents cents; the largest
 * remainder method hands the leftover cents to the lines with the biggest
 * fractional part, which is the allocation an auditor can reproduce.
 */
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

/**
 * Totals for a single line with no document discount to allocate.
 *
 * Kept as the one-line case of `computeTotals` rather than a second
 * implementation, so the two can never disagree.
 */
export function computeLine(line: LineInput): LineTotals {
  return computeTotals([line]).lines[0];
}

/**
 * Totals for one document.
 *
 * The discount reduces each line's taxable base before tax is computed, so
 * tax is never charged on money the customer does not pay and the tax is
 * rounded once rather than being scaled after the fact.
 *
 * It is allocated across every line, taxed or not, in proportion to value.
 * A discount that should fall on one specific line has to be modelled as a
 * change to that line, not as a document-level discount — the allocation here
 * cannot know the intent.
 */
export function computeTotals(inputs: LineInput[], discountCents = 0): DocumentTotals {
  const subtotals = inputs.map((l) => roundHalfUp(l.quantity * l.unitPriceCents));
  const subtotalCents = subtotals.reduce((s, v) => s + v, 0);

  const discount = Math.min(Math.max(Math.trunc(discountCents), 0), subtotalCents);
  const shares = allocate(discount, subtotals);

  const lines: LineTotals[] = inputs.map((line, i) => {
    const treatment: TaxTreatment = line.taxTreatment ?? 'taxable';
    const lineSubtotalCents = subtotals[i];
    const lineDiscountCents = shares[i];
    const lineTaxableBaseCents = lineSubtotalCents - lineDiscountCents;
    const appliedTaxRateBp = treatment === 'taxable' ? line.taxRateBp : 0;
    const lineTaxCents = roundHalfUp((lineTaxableBaseCents * appliedTaxRateBp) / 10_000);

    return {
      ...line,
      taxTreatment: treatment,
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

export function formatMoney(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
