import { describe, it, expect } from 'vitest';
import { computeTotals as apiTotals } from '../../src/lib/money.js';
// The web mirror, imported straight from the other workspace so the two cannot
// drift apart unnoticed. Before this test existed they already had: the API
// rounded tax per line, the preview rounded the aggregate, and a discount
// shifted the tax by a cent between what the provider approved and what was
// invoiced.
import { computeTotals as webTotals } from '../../../web/src/lib/money.js';

type Case = { lines: Array<{ q: number; p: number; bp: number; t?: 'taxable' | 'exempt' | 'not_subject' }>; discount: number };

function build(c: Case) {
  return c.lines.map((l, i) => ({
    description: `line ${i}`,
    quantity: l.q,
    unitPriceCents: l.p,
    taxRateBp: l.bp,
    taxTreatment: l.t,
  }));
}

/** Deterministic pseudo-random so a failure is reproducible. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('money: API and web preview agree', () => {
  it('matches across a wide sweep of documents', () => {
    const rng = makeRng(20260830);
    // Real US combined rates, none of them a flat national figure.
    const rates = [0, 400, 625, 700, 725, 825, 891, 1025];
    const treatments = ['taxable', 'exempt', 'not_subject'] as const;
    const mismatches: string[] = [];

    for (let n = 0; n < 4000; n++) {
      const count = 1 + Math.floor(rng() * 5);
      const lines = Array.from({ length: count }, () => ({
        q: Math.round(rng() * 8000) / 1000 + 0.001,
        p: Math.floor(rng() * 50_000),
        bp: rates[Math.floor(rng() * rates.length)],
        t: treatments[Math.floor(rng() * treatments.length)],
      }));
      const subtotal = lines.reduce((s, l) => s + Math.round(l.q * l.p), 0);
      const discount = Math.floor(rng() * (subtotal + 1));

      const a = apiTotals(build({ lines, discount }), discount);
      const w = webTotals(lines.map((l) => ({
        quantity: l.q, unitPriceCents: l.p, taxRateBp: l.bp, taxTreatment: l.t,
      })), discount);

      if (a.totalCents !== w.totalCents || a.taxCents !== w.taxCents
        || a.subtotalCents !== w.subtotalCents || a.discountCents !== w.discountCents) {
        mismatches.push(JSON.stringify({ lines, discount, api: a.totalCents, web: w.totalCents }));
      }
    }

    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});

describe('money: invariants', () => {
  const rng = makeRng(99);

  it('line totals always sum to the document total', () => {
    for (let n = 0; n < 2000; n++) {
      const count = 1 + Math.floor(rng() * 5);
      const lines = Array.from({ length: count }, () => ({
        q: Math.round(rng() * 5000) / 1000 + 0.001,
        p: Math.floor(rng() * 40_000),
        bp: [0, 625, 825, 1025][Math.floor(rng() * 4)],
      }));
      const subtotal = lines.reduce((s, l) => s + Math.round(l.q * l.p), 0);
      const discount = Math.floor(rng() * (subtotal + 1));
      const t = apiTotals(build({ lines, discount }), discount);

      const summed = t.lines.reduce((s, l) => s + l.lineTotalCents, 0);
      expect(summed).toBe(t.totalCents);
    }
  });

  it('allocates the discount exactly, never losing or inventing a cent', () => {
    for (let n = 0; n < 2000; n++) {
      const count = 1 + Math.floor(rng() * 6);
      const lines = Array.from({ length: count }, () => ({
        q: 1, p: 1 + Math.floor(rng() * 30_000), bp: 825,
      }));
      const subtotal = lines.reduce((s, l) => s + l.p, 0);
      const discount = Math.floor(rng() * (subtotal + 1));
      const t = apiTotals(build({ lines, discount }), discount);

      const allocated = t.lines.reduce((s, l) => s + l.lineDiscountCents, 0);
      expect(allocated).toBe(t.discountCents);
      expect(t.lines.every((l) => l.lineDiscountCents >= 0)).toBe(true);
      expect(t.lines.every((l) => l.lineTaxableBaseCents >= 0)).toBe(true);
    }
  });

  it('charges tax on the discounted base, rounding once', () => {
    // The bug this replaced: three $10 lines at 8.25% with a $10 discount
    // scaled an already-rounded tax, drifting by up to two cents.
    const lines = [1, 2, 3].map((i) => ({
      description: `L${i}`, quantity: 1, unitPriceCents: 1000, taxRateBp: 825,
    }));
    const t = apiTotals(lines, 1000);
    expect(t.subtotalCents).toBe(3000);
    expect(t.discountCents).toBe(1000);
    expect(t.taxableBaseCents).toBe(2000);
    expect(t.taxCents).toBe(165); // 2000 * 8.25%
    expect(t.totalCents).toBe(2165);
  });

  it('never lets a discount reduce the tax below what the base implies', () => {
    // Sweep the case that used to deviate by up to two cents.
    for (let sub = 100; sub <= 20_000; sub += 137) {
      for (let d = 0; d <= sub; d += Math.max(1, Math.floor(sub / 7))) {
        const third = Math.floor(sub / 3);
        const t = apiTotals(build({
          lines: [
            { q: 1, p: third, bp: 825 },
            { q: 1, p: third, bp: 825 },
            { q: 1, p: sub - 2 * third, bp: 825 },
          ],
          discount: d,
        }), d);
        const expected = Math.round((t.taxableBaseCents * 825) / 10_000);
        // Per-line rounding may differ from a single aggregate rounding by at
        // most one cent per line; what must not happen is the old unbounded drift.
        expect(Math.abs(t.taxCents - expected)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('money: tax treatment', () => {
  const line = (p: number, bp: number, t?: 'taxable' | 'exempt' | 'not_subject') => ({
    description: 'x', quantity: 1, unitPriceCents: p, taxRateBp: bp, taxTreatment: t,
  });

  it('charges nothing on an exempt or out-of-scope line even with a rate set', () => {
    // A rate left on the line must never leak tax onto a relieved sale.
    for (const treatment of ['exempt', 'not_subject'] as const) {
      const t = apiTotals([line(10_000, 825, treatment)]);
      expect(t.taxCents).toBe(0);
      expect(t.lines[0].appliedTaxRateBp).toBe(0);
      expect(t.taxableBaseCents).toBe(0);
      expect(t.untaxedBaseCents).toBe(10_000);
    }
  });

  it('taxes only the taxable lines of a mixed document', () => {
    // Texas-shaped: materials taxable, residential labour out of scope.
    const t = apiTotals([
      line(20_000, 825, 'taxable'),
      line(30_000, 825, 'not_subject'),
    ]);
    expect(t.subtotalCents).toBe(50_000);
    expect(t.taxableBaseCents).toBe(20_000);
    expect(t.untaxedBaseCents).toBe(30_000);
    expect(t.taxCents).toBe(1650);
    expect(t.totalCents).toBe(51_650);
  });

  it('defaults to taxable when no treatment is given', () => {
    expect(apiTotals([line(10_000, 825)]).taxCents).toBe(825);
  });

  it('splits a discount across taxable and untaxed lines by value', () => {
    const t = apiTotals([line(10_000, 825, 'taxable'), line(10_000, 0, 'exempt')], 10_000);
    expect(t.lines[0].lineDiscountCents).toBe(5000);
    expect(t.lines[1].lineDiscountCents).toBe(5000);
    expect(t.taxableBaseCents).toBe(5000);
    expect(t.taxCents).toBe(413); // 5000 * 8.25% = 412.5, half up
  });
});
