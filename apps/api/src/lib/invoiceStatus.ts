/**
 * Invoice statuses, in one place.
 *
 * These were spelled out as SQL string literals in five modules — the
 * outstanding total on the dashboard, the outstanding total on the invoice
 * list, the account-deletion guard, the list filter and the overdue sweep.
 * Adding 'viewed' to the schema without finding all five would have quietly
 * dropped every viewed invoice out of the money a provider is owed, and
 * stopped it ever being marked overdue.
 */

export const INVOICE_STATUSES = [
  'draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * Issued, not settled, not cancelled: the money a provider is actually owed.
 * 'draft' is not owed yet, 'paid' no longer is, 'void' never was.
 */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'sent', 'viewed', 'partially_paid', 'overdue',
];

/**
 * Statuses the overdue sweep may move. 'overdue' is excluded because it is
 * already there, and moving it again would re-notify the provider daily.
 */
export const OVERDUE_CANDIDATE_STATUSES: readonly InvoiceStatus[] = [
  'sent', 'viewed', 'partially_paid',
];

/** Renders a status list as a SQL `IN (...)` tuple. Values are compile-time constants. */
export const sqlIn = (statuses: readonly string[]): string =>
  `(${statuses.map((s) => `'${s}'`).join(',')})`;
