import { describe, it, expect } from 'vitest';
import { formatRateBp, lineTaxLabel, relievedNote } from '../../src/lib/pdf.js';
import { computeTotals } from '../../src/lib/money.js';
import {
  INVOICE_STATUSES, OPEN_INVOICE_STATUSES, OVERDUE_CANDIDATE_STATUSES, sqlIn,
} from '../../src/lib/invoiceStatus.js';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe('the rate printed on the document', () => {
  it('does not truncate a fractional rate', () => {
    // The defect this replaces: `(bp / 100).toFixed(0)` printed an 8.25% rate
    // as "8%" on the customer's copy while charging 8.25%.
    expect(formatRateBp(825)).toBe('8.25%');
    expect(formatRateBp(4875)).toBe('48.75%');
    expect(formatRateBp(1)).toBe('0.01%');
  });

  it('does not pad a whole rate with noise', () => {
    expect(formatRateBp(700)).toBe('7%');
    expect(formatRateBp(0)).toBe('0%');
    expect(formatRateBp(650)).toBe('6.5%');
  });

  it('matches the figure actually charged', () => {
    const { lines } = computeTotals([
      { description: 'Repair', quantity: 1, unitPriceCents: 10_000, taxRateBp: 825 },
    ]);
    expect(lines[0].lineTaxCents).toBe(825);
    expect(formatRateBp(lines[0].appliedTaxRateBp)).toBe('8.25%');
  });
});

describe('the tax column', () => {
  const base = { description: 'x', quantity: 1, unitPriceCents: 10_000, lineTotalCents: 10_825 };

  it('shows the rate and the amount for a taxed line', () => {
    expect(lineTaxLabel(
      { ...base, taxRateBp: 825, lineTaxCents: 825, taxTreatment: 'taxable' }, money,
    )).toBe('8.25%  $8.25');
  });

  it('shows nothing for an exempt line even when a rate is stored', () => {
    // Printing the stored rate beside a line charged nothing invites the
    // reader to conclude the arithmetic is wrong. This is what it used to do.
    expect(lineTaxLabel(
      { ...base, taxRateBp: 825, lineTaxCents: 0, taxTreatment: 'exempt' }, money,
    )).toBe('—');
  });

  it('shows nothing for a line outside the scope of the tax', () => {
    expect(lineTaxLabel(
      { ...base, taxRateBp: 825, lineTaxCents: 0, taxTreatment: 'not_subject' }, money,
    )).toBe('—');
  });

  it('shows the figure for a hand-adjusted line, which still charges tax', () => {
    expect(lineTaxLabel(
      { ...base, taxRateBp: 500, lineTaxCents: 500, taxTreatment: 'manual_adjustment' }, money,
    )).toBe('5%  $5.00');
  });

  it('falls back to the rate alone when no amount was supplied', () => {
    expect(lineTaxLabel({ ...base, taxRateBp: 825 }, money)).toBe('8.25%');
  });
});

describe('the note under a line', () => {
  const base = {
    description: 'x', quantity: 1, unitPriceCents: 1000, taxRateBp: 0, lineTotalCents: 1000,
  };

  it('states why a line was relieved, which the document never used to say', () => {
    const note = relievedNote({
      ...base,
      taxTreatment: 'not_subject',
      taxReason: 'Labour on residential real property, Texas',
      lineKind: 'labour',
    });
    expect(note).toBe(
      'Labour · Not subject to sales tax — Labour on residential real property, Texas',
    );
  });

  it('carries the certificate reference a state may require the seller to hold', () => {
    const note = relievedNote({
      ...base,
      taxTreatment: 'exempt',
      taxReason: 'Capital improvement',
      taxExemptionCertificate: 'ST-124 2026-0042',
      lineKind: 'materials',
    })!;
    expect(note).toContain('ST-124 2026-0042');
    expect(note).toContain('Capital improvement');
  });

  it('flags a hand-set figure as adjusted rather than relieved', () => {
    expect(relievedNote({ ...base, taxTreatment: 'manual_adjustment', taxReason: 'Agreed with CPA' }))
      .toContain('Tax adjusted manually');
  });

  it('still names what the line is when there is nothing to explain', () => {
    expect(relievedNote({ ...base, taxTreatment: 'taxable', lineKind: 'materials' }))
      .toBe('Materials');
    expect(relievedNote({ ...base, taxTreatment: 'taxable', lineKind: 'other' })).toBeNull();
  });
});

describe('manual adjustment in the totals', () => {
  it('charges tax and counts toward the taxable base', () => {
    const totals = computeTotals([
      {
        description: 'Adjusted', quantity: 1, unitPriceCents: 20_000,
        taxRateBp: 500, taxTreatment: 'manual_adjustment', taxReason: 'Agreed with CPA',
      },
    ]);
    expect(totals.taxCents).toBe(1_000);
    expect(totals.taxableBaseCents).toBe(20_000);
    expect(totals.untaxedBaseCents).toBe(0);
  });

  it('is distinguishable from exempt, which charges nothing', () => {
    const exempt = computeTotals([
      {
        description: 'Exempt', quantity: 1, unitPriceCents: 20_000,
        taxRateBp: 500, taxTreatment: 'exempt', taxReason: 'Certificate on file',
      },
    ]);
    expect(exempt.taxCents).toBe(0);
    expect(exempt.untaxedBaseCents).toBe(20_000);
  });
});

describe('the taxable base with mixed treatments', () => {
  it('splits a Texas-style job into taxed materials and untaxed labour', () => {
    // Texas Comptroller 94-116: on residential real property under a separated
    // contract the materials are taxable and the construction labour is not.
    const totals = computeTotals([
      {
        description: 'Drywall and compound', quantity: 1, unitPriceCents: 48_000,
        taxRateBp: 825, taxTreatment: 'taxable', lineKind: 'materials',
      },
      {
        description: 'Installation labour', quantity: 16, unitPriceCents: 4_500,
        taxRateBp: 825, taxTreatment: 'not_subject', lineKind: 'labour',
        taxReason: 'Labour on residential real property is not subject to Texas sales tax',
      },
    ]);

    expect(totals.subtotalCents).toBe(120_000);
    expect(totals.taxableBaseCents).toBe(48_000);
    expect(totals.untaxedBaseCents).toBe(72_000);
    expect(totals.taxCents).toBe(3_960);
    expect(totals.totalCents).toBe(123_960);
    expect(totals.lines[1].lineTaxCents).toBe(0);
    // The classification survives into the stored line, which is what makes
    // the treatment defensible later.
    expect(totals.lines[0].lineKind).toBe('materials');
    expect(totals.lines[1].lineKind).toBe('labour');
  });

  it('keeps the two bases summing to the discounted subtotal', () => {
    const totals = computeTotals(
      [
        { description: 'a', quantity: 3, unitPriceCents: 3_333, taxRateBp: 725 },
        {
          description: 'b', quantity: 1, unitPriceCents: 10_001, taxRateBp: 725,
          taxTreatment: 'exempt', taxReason: 'Certificate on file',
        },
      ],
      1_777,
    );
    expect(totals.taxableBaseCents + totals.untaxedBaseCents)
      .toBe(totals.subtotalCents - totals.discountCents);
  });

  it('defaults an unclassified line to "other" rather than guessing', () => {
    const totals = computeTotals([
      { description: 'Call-out', quantity: 1, unitPriceCents: 5_000, taxRateBp: 0 },
    ]);
    expect(totals.lines[0].lineKind).toBe('other');
  });
});

describe('invoice status sets', () => {
  it('treats a viewed invoice as money still owed', () => {
    // Adding 'viewed' without this would have dropped every viewed invoice
    // out of the outstanding total on the dashboard and the invoice list.
    expect(OPEN_INVOICE_STATUSES).toContain('viewed');
    expect(OPEN_INVOICE_STATUSES).not.toContain('draft');
    expect(OPEN_INVOICE_STATUSES).not.toContain('paid');
    expect(OPEN_INVOICE_STATUSES).not.toContain('void');
  });

  it('lets a viewed invoice still become overdue', () => {
    expect(OVERDUE_CANDIDATE_STATUSES).toContain('viewed');
    // Already overdue: sweeping it again would re-notify the provider daily.
    expect(OVERDUE_CANDIDATE_STATUSES).not.toContain('overdue');
  });

  it('only ever names statuses the schema allows', () => {
    for (const s of [...OPEN_INVOICE_STATUSES, ...OVERDUE_CANDIDATE_STATUSES]) {
      expect(INVOICE_STATUSES).toContain(s);
    }
  });

  it('builds a SQL tuple with no room for injection', () => {
    expect(sqlIn(['sent', 'viewed'])).toBe("('sent','viewed')");
  });
});
