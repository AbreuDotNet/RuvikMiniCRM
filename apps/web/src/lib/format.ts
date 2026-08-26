export function formatMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Compact form for dashboard tiles: $1.2k rather than $1,234.00 */
export function formatMoneyCompact(cents: number, currency = 'USD'): string {
  const value = cents / 100;
  if (Math.abs(value) < 1000) return formatMoney(cents, currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(input: string | null | undefined): string {
  if (!input) return '—';
  return new Date(input).toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function formatDateTime(input: string | null | undefined): string {
  if (!input) return '—';
  return new Date(input).toLocaleString('en-US', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export function formatRelative(input: string | null | undefined): string {
  if (!input) return '';
  const diffMs = Date.now() - new Date(input).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(input);
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.round(hours / 8); // working days
    return `~${days} working day${days === 1 ? '' : 's'}`;
  }
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const STATUS_LABELS: Record<string, string> = {
  new_lead: 'New lead',
  contacted: 'Contacted',
  quoted: 'Quoted',
  approved: 'Approved',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  paid: 'Paid',
  partially_paid: 'Part paid',
  overdue: 'Overdue',
  void: 'Void',
  active: 'Active',
  paused: 'Paused',
  pending_payment: 'Awaiting payment',
  past_due: 'Past due',
  trialing: 'Trial',
  verified: 'Verified',
  unverified: 'Unverified',
  pending: 'Pending review',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export type PillTone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger';

export function statusTone(status: string): PillTone {
  switch (status) {
    case 'completed':
    case 'accepted':
    case 'paid':
    case 'active':
    case 'verified':
      return 'success';
    case 'cancelled':
    case 'declined':
    case 'overdue':
    case 'void':
    case 'rejected':
    case 'suspended':
      return 'danger';
    case 'new_lead':
    case 'sent':
    case 'quoted':
      return 'accent';
    case 'scheduled':
    case 'approved':
    case 'in_progress':
      return 'brand';
    case 'pending_payment':
    case 'past_due':
    case 'partially_paid':
    case 'expired':
    case 'pending':
    case 'paused':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Deterministic avatar colour from a name, so a person keeps the same one. */
export function avatarColor(seed: string): string {
  const palette = ['#3C5A7D', '#C4623F', '#5E846B', '#7A5C8E', '#B4771F', '#4E6F94', '#9E4A2E'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
