import type { TaxTreatment } from '../money.js';

/**
 * Seam for sales tax determination.
 *
 * US sales tax cannot be decided in application code. It turns on the state,
 * the locality, the kind of work, the kind of property, the customer's status
 * and the seller's nexus — and the rules change continuously. Vendors like
 * Avalara and TaxJar exist because keeping that current is a full-time job.
 *
 * So this interface deliberately does NOT promise a correct answer. It
 * promises a *place* to get one, with two properties that matter more than
 * the source of the figure:
 *
 *   1. Whatever decides the tax must say where the decision came from, so an
 *      issued document can be explained years later.
 *   2. Nothing is applied silently. A determination the provider did not
 *      choose is a suggestion until they accept it.
 *
 * The shipped implementation is `ManualTaxProvider`: the provider's own
 * configured rate, which is exactly what a one-state contractor needs and is
 * honest about being their decision rather than ours.
 */

/** What is being sold, because states tax these differently. */
export type LineKind =
  | 'materials'        // tangible personal property transferred to the customer
  | 'labour'           // service labour, often treated separately on real property
  | 'equipment'        // rented or supplied plant
  | 'fee'              // permits, trip charges, disposal
  | 'discount'
  | 'other';

/** Whether work on real property is residential — Texas, among others, splits on this. */
export type PropertyKind = 'residential_real' | 'commercial_real' | 'personal_property' | 'none';

export interface TaxAddress {
  /** Two-letter USPS state code. */
  state: string;
  city?: string | null;
  postalCode?: string | null;
}

export interface TaxLineRequest {
  /** Caller's identifier, echoed back so results can be matched to lines. */
  ref: string;
  kind: LineKind;
  amountCents: number;
}

export interface TaxRequest {
  /** Where the seller is registered. */
  origin: TaxAddress;
  /** Where the work is performed or delivered — what most states source to. */
  destination: TaxAddress;
  propertyKind: PropertyKind;
  /** Set when the customer has given an exemption certificate. */
  exemptionCertificateId?: string | null;
  lines: TaxLineRequest[];
}

export interface TaxLineResult {
  ref: string;
  treatment: TaxTreatment;
  rateBp: number;
  /** Required when the treatment is not 'taxable'; shown on the document. */
  reason: string | null;
}

export interface TaxDetermination {
  lines: TaxLineResult[];
  /** Human-readable jurisdiction, e.g. "TX" or "TX / Travis County". */
  jurisdiction: string;
  /**
   * Where the figures came from: the name of the service and, when there is
   * one, its identifier for this determination. Stored with the document so
   * an audit can trace it back.
   */
  source: string;
  /**
   * False when the caller must confirm before the figures are applied. The
   * manual provider returns false: it is repeating the provider's own setting
   * back to them, not determining anything.
   */
  authoritative: boolean;
  /** Anything the provider should know before accepting the result. */
  warnings: string[];
}

export interface TaxProvider {
  readonly name: string;
  determine(request: TaxRequest): Promise<TaxDetermination>;
}

/**
 * The default: apply the provider's own configured rate, and say plainly that
 * the provider decided it.
 *
 * This is not a fallback for a missing integration — for a contractor working
 * in one state it is the right answer, and it is what the product ships with.
 * What it must never do is imply more certainty than it has, which is why
 * `authoritative` is false and the warnings are explicit.
 */
export class ManualTaxProvider implements TaxProvider {
  readonly name = 'manual';

  constructor(
    private readonly config: {
      rateBp: number;
      state: string | null;
      /** Whether the provider has told us labour is taxable in their state. */
      labourTaxable: boolean;
    },
  ) {}

  async determine(request: TaxRequest): Promise<TaxDetermination> {
    const { rateBp, state, labourTaxable } = this.config;
    const warnings: string[] = [];

    if (!state) {
      warnings.push('No tax state is configured, so no jurisdiction is recorded on this document.');
    }
    if (request.destination.state && state && request.destination.state !== state) {
      // Crossing a state line is exactly where a single configured rate stops
      // being safe, so it is surfaced rather than absorbed.
      warnings.push(
        `The work is in ${request.destination.state} but your settings are for ${state}. ` +
        'Selling into another state can create a filing obligation there — check with a CPA.',
      );
    }
    if (rateBp === 0 && state) {
      warnings.push(`No rate is set for ${state}; nothing will be charged.`);
    }

    const lines = request.lines.map((line): TaxLineResult => {
      if (line.kind === 'discount' || line.amountCents === 0) {
        return { ref: line.ref, treatment: 'taxable', rateBp: 0, reason: null };
      }
      if (request.exemptionCertificateId) {
        return {
          ref: line.ref,
          treatment: 'exempt',
          rateBp: 0,
          reason: `Exemption certificate ${request.exemptionCertificateId} on file`,
        };
      }
      // The one rule this provider encodes, and only because the provider
      // told us it applies in their state.
      if (line.kind === 'labour' && !labourTaxable && request.propertyKind === 'residential_real') {
        return {
          ref: line.ref,
          treatment: 'not_subject',
          rateBp: 0,
          reason: `Labour on residential real property is not subject to sales tax in ${state ?? 'this state'}`,
        };
      }
      return { ref: line.ref, treatment: 'taxable', rateBp, reason: null };
    });

    return {
      lines,
      jurisdiction: state ?? '',
      source: 'manual: rate configured by the provider',
      authoritative: false,
      warnings,
    };
  }
}

/**
 * Chooses the provider for a seller.
 *
 * A single hook, so wiring in a real service later is a change here plus a
 * class that implements the interface — not a change to every screen that
 * touches money.
 */
export function taxProviderFor(config: {
  rateBp: number;
  state: string | null;
  labourTaxable: boolean;
}): TaxProvider {
  return new ManualTaxProvider(config);
}
