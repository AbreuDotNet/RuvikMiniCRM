/**
 * Turning what someone typed into integer cents.
 *
 * Deliberately string arithmetic. `Math.round(parseFloat('8.145') * 100)` is
 * the classic way a price is off by a cent, and a cent that appears here ends
 * up on an invoice, a receipt and a tax return.
 */

export interface ParsedAmount {
  cents: number | null;
  /** Why it could not be read, for an inline field error. */
  error?: string;
}

export function parseAmountToCents(input: string): ParsedAmount {
  const trimmed = input.trim().replace(/[$,\s]/g, '');
  if (!trimmed) return { cents: null, error: 'Enter an amount.' };

  if (!/^\d*(\.\d{0,2})?$/.test(trimmed)) {
    return {
      cents: null,
      error: /\./.test(trimmed) && trimmed.split('.')[1]!.length > 2
        ? 'Amounts go to the cent — two decimal places.'
        : 'Use digits only, for example 450 or 450.75.',
    };
  }

  const [whole = '0', fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));

  if (!Number.isSafeInteger(cents)) return { cents: null, error: 'That amount is too large.' };
  // Matches the server's `moneyCents` ceiling, so the rejection happens here
  // rather than after a round trip.
  if (cents > 100_000_000) return { cents: null, error: 'That amount is above the limit.' };

  return { cents };
}

/** Cents back into an editable string: 12345 becomes "123.45". */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A quantity: positive, up to three decimals, which is what the API accepts.
 * Hours and square metres both land inside that.
 */
export function parseQuantity(input: string): { value: number | null; error?: string } {
  const trimmed = input.trim().replace(/,/g, '.');
  if (!trimmed) return { value: null, error: 'Enter a quantity.' };
  if (!/^\d*(\.\d{0,3})?$/.test(trimmed)) {
    return { value: null, error: 'Use digits, for example 1 or 2.5.' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return { value: null, error: 'Must be more than zero.' };
  if (value > 100_000) return { value: null, error: 'That quantity is above the limit.' };
  return { value };
}

/** A tax rate typed as a percentage, held as basis points. 8.25 becomes 825. */
export function parseRateToBp(input: string): { bp: number | null; error?: string } {
  const trimmed = input.trim().replace(/[%\s]/g, '').replace(/,/g, '.');
  if (!trimmed) return { bp: 0 };
  if (!/^\d*(\.\d{0,2})?$/.test(trimmed)) {
    return { bp: null, error: 'Use a percentage, for example 8.25.' };
  }
  const [whole = '0', fraction = ''] = trimmed.split('.');
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  // The server caps the rate at 15%: the highest US combined state-plus-local
  // rate is around 12%, so anything higher is a typo or a VAT rate.
  if (bp > 1500) return { bp: null, error: 'Sales tax above 15% is not a US rate. Check the figure.' };
  return { bp };
}

export function bpToInput(bp: number): string {
  if (bp % 100 === 0) return String(bp / 100);
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;
}
