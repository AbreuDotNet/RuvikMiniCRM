import { describe, it, expect } from 'vitest';
import { ManualTaxProvider, taxProviderFor, type TaxRequest } from '../../src/lib/tax/provider.js';

const request = (over: Partial<TaxRequest> = {}): TaxRequest => ({
  origin: { state: 'TX', city: 'Austin', postalCode: '78704' },
  destination: { state: 'TX', city: 'Austin', postalCode: '78702' },
  propertyKind: 'residential_real',
  lines: [
    { ref: 'a', kind: 'materials', amountCents: 40_000 },
    { ref: 'b', kind: 'labour', amountCents: 60_000 },
  ],
  ...over,
});

const texas = () => new ManualTaxProvider({ rateBp: 825, state: 'TX', labourTaxable: false });
const newYork = () => new ManualTaxProvider({ rateBp: 888, state: 'NY', labourTaxable: true });

describe('ManualTaxProvider', () => {
  it('never claims to be authoritative', async () => {
    // It is repeating the provider's own setting back to them. Presenting that
    // as a determination is the failure mode this whole seam exists to avoid.
    const result = await texas().determine(request());
    expect(result.authoritative).toBe(false);
    expect(result.source).toContain('configured by the provider');
  });

  it('applies the configured rate to materials', async () => {
    const result = await texas().determine(request());
    const materials = result.lines.find((l) => l.ref === 'a')!;
    expect(materials).toEqual({ ref: 'a', treatment: 'taxable', rateBp: 825, reason: null });
  });

  it('leaves residential labour out of scope where the provider says it is', async () => {
    const labour = (await texas().determine(request())).lines.find((l) => l.ref === 'b')!;
    expect(labour.treatment).toBe('not_subject');
    expect(labour.rateBp).toBe(0);
    expect(labour.reason).toContain('TX');
  });

  it('taxes labour where the provider says it is taxable', async () => {
    const labour = (await newYork().determine(request())).lines.find((l) => l.ref === 'b')!;
    expect(labour.treatment).toBe('taxable');
    expect(labour.rateBp).toBe(888);
  });

  it('taxes labour on commercial property even in a labour-exempt state', async () => {
    // Texas taxes labour on non-residential realty; the rule is scoped to
    // residential, so commercial work must not inherit the relief.
    const result = await texas().determine(request({ propertyKind: 'commercial_real' }));
    expect(result.lines.find((l) => l.ref === 'b')!.treatment).toBe('taxable');
  });

  it('relieves every line when an exemption certificate is on file, and names it', async () => {
    const result = await texas().determine(request({ exemptionCertificateId: 'EX-4417' }));
    expect(result.lines.every((l) => l.treatment === 'exempt')).toBe(true);
    expect(result.lines[0].reason).toContain('EX-4417');
  });

  it('warns when the work crosses a state line', async () => {
    // A single configured rate stops being safe here, so it must be surfaced.
    const result = await texas().determine(request({
      destination: { state: 'NM', city: 'Las Cruces' },
    }));
    expect(result.warnings.join(' ')).toContain('NM');
    expect(result.warnings.join(' ')).toContain('CPA');
  });

  it('warns when no state is configured', async () => {
    const none = new ManualTaxProvider({ rateBp: 0, state: null, labourTaxable: true });
    const result = await none.determine(request());
    expect(result.jurisdiction).toBe('');
    expect(result.warnings.join(' ')).toContain('No tax state');
  });

  it('says so when the state has no rate set', async () => {
    // Oregon: correct answer is zero, but it should not look like an oversight.
    const oregon = new ManualTaxProvider({ rateBp: 0, state: 'OR', labourTaxable: false });
    const result = await oregon.determine(request({ origin: { state: 'OR' }, destination: { state: 'OR' } }));
    expect(result.lines.every((l) => l.rateBp === 0)).toBe(true);
    expect(result.warnings.join(' ')).toContain('OR');
  });

  it('never taxes a discount line', async () => {
    const result = await texas().determine(request({
      lines: [{ ref: 'd', kind: 'discount', amountCents: 5000 }],
    }));
    expect(result.lines[0].rateBp).toBe(0);
  });

  it('returns a result for every line, matched by ref', async () => {
    const req = request();
    const result = await texas().determine(req);
    expect(result.lines.map((l) => l.ref)).toEqual(req.lines.map((l) => l.ref));
  });

  it('is what the factory hands back today', async () => {
    const provider = taxProviderFor({ rateBp: 700, state: 'FL', labourTaxable: true });
    expect(provider.name).toBe('manual');
  });
});
