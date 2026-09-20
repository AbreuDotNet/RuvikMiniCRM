/**
 * Status vocabulary: how a server-side status reads and which colour it wears.
 *
 * Presentation only. Whether a transition is *allowed* is the server's call —
 * jobs carry `allowedNextStatuses`, and this file must never be mistaken for
 * that list.
 */

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusLook {
  label: string;
  tone: Tone;
  /** One line explaining what this state means, for a sheet or a hint. */
  hint?: string;
}

const JOB: Record<string, StatusLook> = {
  new_lead: { label: 'New lead', tone: 'info', hint: 'Nobody has reached out yet.' },
  contacted: { label: 'Contacted', tone: 'info', hint: 'You have been in touch with the client.' },
  quoted: { label: 'Quoted', tone: 'primary', hint: 'A quote is with the client.' },
  approved: { label: 'Approved', tone: 'primary', hint: 'The client accepted. Book it in.' },
  scheduled: { label: 'Scheduled', tone: 'primary', hint: 'A date is set.' },
  in_progress: { label: 'In progress', tone: 'warning', hint: 'Work has started.' },
  completed: { label: 'Completed', tone: 'success', hint: 'Finished. The client can review it.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', hint: 'Closed without finishing.' },
};

const QUOTE: Record<string, StatusLook> = {
  draft: { label: 'Draft', tone: 'neutral', hint: 'Only you can see this.' },
  sent: { label: 'Sent', tone: 'primary', hint: 'Waiting on the client.' },
  accepted: { label: 'Accepted', tone: 'success', hint: 'Ready to invoice.' },
  declined: { label: 'Declined', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const INVOICE: Record<string, StatusLook> = {
  draft: { label: 'Draft', tone: 'neutral', hint: 'Not sent yet.' },
  sent: { label: 'Sent', tone: 'primary', hint: 'With the client, unopened.' },
  viewed: { label: 'Viewed', tone: 'primary', hint: 'The client has opened it.' },
  partially_paid: { label: 'Part paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral', hint: 'Cancelled. Kept for the record.' },
};

const SUBSCRIPTION: Record<string, StatusLook> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning' },
  trialing: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Past due', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'danger' },
};

const VERIFICATION: Record<string, StatusLook> = {
  unverified: { label: 'Not verified', tone: 'neutral' },
  pending: { label: 'Under review', tone: 'warning' },
  info_requested: { label: 'More info needed', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

function look(table: Record<string, StatusLook>, status: string | null | undefined): StatusLook {
  if (!status) return { label: '—', tone: 'neutral' };
  return table[status] ?? { label: humanise(status), tone: 'neutral' };
}

/** An unknown status from a newer server still has to render as something. */
export function humanise(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const jobStatus = (s: string | null | undefined) => look(JOB, s);
export const quoteStatus = (s: string | null | undefined) => look(QUOTE, s);
export const invoiceStatus = (s: string | null | undefined) => look(INVOICE, s);
export const subscriptionStatus = (s: string | null | undefined) => look(SUBSCRIPTION, s);
export const verificationStatus = (s: string | null | undefined) => look(VERIFICATION, s);

/** Statuses a provider filters their pipeline by, in workflow order. */
export const JOB_FILTERS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'new_lead', label: 'Leads' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'Active' },
  { value: 'completed', label: 'Done' },
];

/**
 * Subscription states under which listings stay visible in search.
 *
 * Mirrors the server's `LIVE_SUBSCRIPTION` filter and exists only so the app
 * can *warn* a provider that their listings are hidden. The server decides.
 */
const VISIBLE_SUBSCRIPTION = ['trialing', 'active', 'past_due'];

export function listingsAreLive(status: string | null | undefined): boolean {
  return status != null && VISIBLE_SUBSCRIPTION.includes(status);
}

export const TAX_TREATMENT_LABELS: Record<string, string> = {
  taxable: 'Taxable',
  exempt: 'Exempt (certificate on file)',
  not_subject: 'Not subject to tax',
  manual_adjustment: 'Manually adjusted',
};

export const LINE_KIND_LABELS: Record<string, string> = {
  materials: 'Materials',
  labour: 'Labour',
  equipment: 'Equipment',
  fee: 'Fee',
  reimbursement: 'Reimbursement',
  deposit: 'Deposit',
  other: 'Other',
};
