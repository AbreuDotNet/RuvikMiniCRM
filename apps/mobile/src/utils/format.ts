/**
 * Display formatting.
 *
 * Written by hand rather than through `Intl`. Hermes ships a partial ICU and
 * the pieces that are present differ between iOS and Android builds, so the
 * same invoice could print two different totals depending on the phone. These
 * are pure, deterministic and unit-tested instead.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  DOP: 'RD$',
};

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Integer cents to a currency string. Never floating point on the way in. */
export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';

  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = groupThousands(String(Math.floor(abs / 100)));
  const fraction = String(abs % 100).padStart(2, '0');

  return `${negative ? '-' : ''}${symbol}${whole}.${fraction}`;
}

/** Compact form for dashboard tiles: $1.2k rather than $1,234.00. */
export function formatMoneyCompact(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  const abs = Math.abs(cents);
  if (abs < 100_000) return formatMoney(cents, currency);

  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  const sign = cents < 0 ? '-' : '';
  const units = abs / 100;
  if (units < 1_000_000) {
    const k = Math.round(units / 100) / 10;
    return `${sign}${symbol}${k}k`;
  }
  const m = Math.round(units / 100_000) / 10;
  return `${sign}${symbol}${m}M`;
}

/** Basis points as a percentage: 825 becomes "8.25%". */
export function formatRateBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(Math.abs(bp % 100)).padStart(2, '0');
  const trimmed = fraction.endsWith('0') && fraction !== '00' ? fraction.slice(0, 1) : fraction;
  return fraction === '00' ? `${whole}%` : `${whole}.${trimmed}%`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parse(input: string | null | undefined): Date | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(input: string | null | undefined): string {
  const d = parse(input);
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDayMonth(input: string | null | undefined): string {
  const d = parse(input);
  if (!d) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatWeekday(input: string | null | undefined): string {
  const d = parse(input);
  if (!d) return '';
  return WEEKDAYS[d.getDay()] ?? '';
}

export function formatTime(input: string | null | undefined): string {
  const d = parse(input);
  if (!d) return '—';
  const hours = d.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

export function formatDateTime(input: string | null | undefined): string {
  const d = parse(input);
  if (!d) return '—';
  return `${formatDayMonth(input)}, ${formatTime(input)}`;
}

/** "3h ago" close up, an absolute date once that stops being useful. */
export function formatRelative(input: string | null | undefined, now = Date.now()): string {
  const d = parse(input);
  if (!d) return '';
  const minutes = Math.round((now - d.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(input);
}

/**
 * How long something has been waiting, always as an elapsed span.
 *
 * `formatRelative` degrades to an absolute date past a week, which is right
 * for "last seen" and wrong for a queue: "waiting 25 Aug" makes the reader do
 * the subtraction, and that subtraction is what the queue is sorted on.
 */
export function formatWaiting(input: string | null | undefined, now = Date.now()): string {
  const d = parse(input);
  if (!d) return '';
  const hours = Math.floor((now - d.getTime()) / 3_600_000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `YYYY-MM-DD` in local time, which is what the API's date fields expect. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
