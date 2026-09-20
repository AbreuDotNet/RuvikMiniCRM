import { describe, it, expect } from 'vitest';

import {
  bpToInput, centsToInput, parseAmountToCents, parseQuantity, parseRateToBp,
} from './moneyInput';
import { formatMoney, formatMoneyCompact, formatRateBp } from './format';

describe('parseAmountToCents', () => {
  it('reads plain and decimal amounts exactly', () => {
    expect(parseAmountToCents('450').cents).toBe(45_000);
    expect(parseAmountToCents('450.75').cents).toBe(45_075);
    expect(parseAmountToCents('0.05').cents).toBe(5);
    expect(parseAmountToCents('.5').cents).toBe(50);
  });

  it('ignores the currency symbol and separators people type', () => {
    expect(parseAmountToCents('$1,234.56').cents).toBe(123_456);
    expect(parseAmountToCents(' 99.99 ').cents).toBe(9_999);
  });

  it('does not drift the way floating point would', () => {
    // parseFloat('8.145') * 100 is 814.4999999999999, and Math.round saves it
    // only by luck. These are the amounts where luck runs out.
    for (const [input, expected] of [
      ['1.005', null], // three decimals: rejected outright, not rounded silently
      ['0.07', 7],
      ['1.10', 110],
      ['1.1', 110],
      ['8.14', 814],
      ['1234.56', 123_456],
      ['999999.99', 99_999_999],
    ] as const) {
      expect(parseAmountToCents(input).cents).toBe(expected);
    }
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseAmountToCents('').cents).toBeNull();
    expect(parseAmountToCents('abc').cents).toBeNull();
    expect(parseAmountToCents('-5').cents).toBeNull();
    expect(parseAmountToCents('1.2.3').cents).toBeNull();
    expect(parseAmountToCents('1.234').error).toMatch(/two decimal places/);
  });

  it('rejects an amount past the server ceiling before the round trip', () => {
    expect(parseAmountToCents('1000000.01').cents).toBeNull();
    expect(parseAmountToCents('1000000.00').cents).toBe(100_000_000);
  });

  it('round-trips through centsToInput', () => {
    for (const cents of [0, 5, 99, 100, 12_345, 100_000_000]) {
      expect(parseAmountToCents(centsToInput(cents)).cents).toBe(cents);
    }
  });
});

describe('parseQuantity', () => {
  it('accepts whole and fractional quantities', () => {
    expect(parseQuantity('1').value).toBe(1);
    expect(parseQuantity('2.5').value).toBe(2.5);
    expect(parseQuantity('16.125').value).toBe(16.125);
    expect(parseQuantity('2,5').value).toBe(2.5);
  });

  it('refuses zero, negatives and nonsense', () => {
    expect(parseQuantity('0').value).toBeNull();
    expect(parseQuantity('-1').value).toBeNull();
    expect(parseQuantity('two').value).toBeNull();
    expect(parseQuantity('1.2345').value).toBeNull();
  });
});

describe('parseRateToBp', () => {
  it('reads a percentage as basis points', () => {
    expect(parseRateToBp('8.25').bp).toBe(825);
    expect(parseRateToBp('6').bp).toBe(600);
    expect(parseRateToBp('0').bp).toBe(0);
    expect(parseRateToBp('8.9%').bp).toBe(890);
    expect(parseRateToBp('').bp).toBe(0);
  });

  it('refuses a rate that is not a US sales tax', () => {
    // 18% is the Dominican ITBIS, which this app once defaulted to. The
    // highest US combined rate is around 12%.
    expect(parseRateToBp('18').bp).toBeNull();
    expect(parseRateToBp('18').error).toMatch(/not a US rate/);
    expect(parseRateToBp('15').bp).toBe(1500);
  });

  it('round-trips through bpToInput', () => {
    for (const bp of [0, 400, 625, 825, 891, 1025, 1500]) {
      expect(parseRateToBp(bpToInput(bp)).bp).toBe(bp);
    }
  });
});

describe('formatting', () => {
  it('formats cents without touching floating point', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(123_456)).toBe('$1,234.56');
    expect(formatMoney(100_000_000)).toBe('$1,000,000.00');
    expect(formatMoney(-2_500)).toBe('-$25.00');
    expect(formatMoney(null)).toBe('—');
  });

  it('groups every thousand, not just the first', () => {
    expect(formatMoney(1_000_00)).toBe('$1,000.00');
    expect(formatMoney(1_000_000_00)).toBe('$1,000,000.00');
  });

  it('compacts only where the detail stops mattering', () => {
    expect(formatMoneyCompact(99_999)).toBe('$999.99');
    expect(formatMoneyCompact(123_456)).toBe('$1.2k');
    expect(formatMoneyCompact(1_234_567_89)).toBe('$1.2M');
  });

  it('prints a tax rate without truncating it', () => {
    // A regex slip here once turned "6.50" into "6." on a live invoice.
    expect(formatRateBp(825)).toBe('8.25%');
    expect(formatRateBp(650)).toBe('6.5%');
    expect(formatRateBp(600)).toBe('6%');
    expect(formatRateBp(0)).toBe('0%');
    expect(formatRateBp(1025)).toBe('10.25%');
  });
});
