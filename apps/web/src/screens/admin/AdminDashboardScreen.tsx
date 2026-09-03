import { Link } from 'react-router-dom';
import { Shell, AccountAction } from '../../components/Shell';
import { ADMIN_TABS } from '../../components/nav';
import { Icon, type IconName } from '../../components/Icon';
import {
  Pill, SkeletonList, ErrorState, Section, RefreshBar, EmptyState,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatMoneyCompact, formatRelative, formatWaiting } from '../../lib/format';
import { STATE_LABELS, type EffectiveState } from '../../lib/providerLifecycle';
import { StateBadge } from './AdminProvidersScreen';

/* ================================= types ================================= */

interface Metrics {
  users: {
    customers: number; providers: number;
    suspended: number; blocked: number; newLast30Days: number;
  };
  providers: {
    pendingVerification: number; pending: number; infoRequested: number;
    verified: number; rejected: number; unverified: number;
    suspended: number; blocked: number; published: number; total: number;
  };
  commerce: {
    jobs: number; completedJobs: number; quotes: number;
    acceptedQuotes: number; invoices: number; gmvCents: number;
  };
  subscriptions: { active: number; pastDue: number; mrrCents: number };
  moderation: { flaggedReviews: number; openTickets: number };
  queue: Record<string, number>;
  reviewQueue: Array<{
    id: string; businessName: string; city: string | null;
    region: string | null; state: EffectiveState; waitingSince: string;
  }>;
  recentActivity: Array<{
    id: number; action: string; actorRole: string | null; actorName: string | null;
    entityType: string | null; entityId: string | null;
    metadata: Record<string, unknown>; createdAt: string;
  }>;
}

/* ================================ screen ================================= */

export function AdminDashboardScreen() {
  const metrics = useApi(() => api.get<Metrics>('/admin/metrics'), []);

  if (metrics.loading) {
    return (
      <Shell title="Overview" tabs={ADMIN_TABS} action={<AccountAction />}>
        <SkeletonList rows={6} />
      </Shell>
    );
  }
  if (metrics.error || !metrics.data) {
    return (
      <Shell title="Overview" tabs={ADMIN_TABS} action={<AccountAction />}>
        <ErrorState message={metrics.error ?? 'Could not load metrics.'} onRetry={metrics.reload} />
      </Shell>
    );
  }

  const m = metrics.data;
  const attention = buildAttention(m);

  return (
    <Shell title="Overview" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div aria-busy={metrics.refreshing}>
        <RefreshBar active={metrics.refreshing} />

        <NeedsAttention items={attention} />

        <Section
          title="Providers"
          action={<Link className="section__link" to="/admin/providers">All {m.providers.total}</Link>}
        >
          {/* Every tile is a link into the list it counted. A number an admin
              cannot open is a number they have to go and look for by hand. */}
          <div className="stat-grid">
            <TileLink
              to="/admin/providers?state=pending"
              value={m.providers.pending}
              label="Pending review"
              tone={m.providers.pending > 0 ? 'brand' : undefined}
            />
            <TileLink
              to="/admin/providers?state=info_requested"
              value={m.providers.infoRequested}
              label="Info requested"
            />
            <TileLink
              to="/admin/providers?state=verified"
              value={m.providers.verified}
              label="Verified"
              tone="sage"
            />
            <TileLink
              to="/admin/providers?state=unverified"
              value={m.providers.unverified}
              label="Not submitted"
            />
            <TileLink
              to="/admin/providers?state=rejected"
              value={m.providers.rejected}
              label="Rejected"
            />
            <TileLink
              to="/admin/providers?state=suspended"
              value={m.providers.suspended}
              label="Suspended"
            />
            <TileLink
              to="/admin/providers?state=blocked"
              value={m.providers.blocked}
              label="Blocked"
            />
            <TileLink
              to="/admin/providers"
              value={m.providers.published}
              label="Listed publicly"
            />
          </div>
        </Section>

        <ReviewQueue items={m.reviewQueue} pending={m.providers.pending + m.providers.infoRequested} />

        <Section title="Platform">
          <div className="stat-grid">
            <TileLink to="/admin/users?role=customer" value={m.users.customers} label="Customers" />
            <TileLink to="/admin/users?role=provider" value={m.users.providers} label="Provider accounts" />
            <Tile value={m.users.newLast30Days} label="New (30 days)" />
            <TileLink
              to="/admin/users?status=suspended"
              value={m.users.suspended + m.users.blocked}
              label="Stopped accounts"
            />
          </div>
        </Section>

        <Section title="Revenue">
          <div className="stat-grid">
            <Tile
              value={formatMoneyCompact(m.subscriptions.mrrCents)}
              label="Monthly recurring"
              tone="accent"
            />
            <Tile value={formatMoneyCompact(m.commerce.gmvCents)} label="Invoiced volume" />
            <Tile value={m.subscriptions.active} label="Active plans" />
            <Tile value={m.subscriptions.pastDue} label="Past due" />
          </div>
        </Section>

        <Section title="Marketplace activity">
          <div className="list-group">
            <MetricRow label="Jobs created" value={m.commerce.jobs} />
            <MetricRow label="Jobs completed" value={m.commerce.completedJobs} />
            <MetricRow label="Quotes sent" value={m.commerce.quotes} />
            <MetricRow
              label="Quotes accepted"
              value={m.commerce.acceptedQuotes}
              hint={
                m.commerce.quotes > 0
                  ? `${Math.round((m.commerce.acceptedQuotes / m.commerce.quotes) * 100)}% conversion`
                  : undefined
              }
            />
            <MetricRow label="Invoices issued" value={m.commerce.invoices} />
          </div>
        </Section>

        <RecentActivity entries={m.recentActivity} />

        <Section title="Background jobs">
          <div className="list-group">
            {Object.entries(m.queue).length === 0 ? (
              <div className="list-item" style={{ cursor: 'default' }}>
                <span className="grow small muted">Queue is empty</span>
              </div>
            ) : (
              Object.entries(m.queue).map(([status, count]) => (
                <div key={status} className="list-item" style={{ cursor: 'default' }}>
                  <span className="grow small" style={{ textTransform: 'capitalize' }}>{status}</span>
                  <Pill tone={status === 'dead' || status === 'failed' ? 'danger' : 'neutral'}>
                    {count}
                  </Pill>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </Shell>
  );
}

/* ============================ needs attention ============================ */

interface AttentionItem {
  key: string;
  count: number;
  label: string;
  to: string;
  icon: IconName;
  tone: 'danger' | 'warning';
}

/**
 * The only section above the fold. It lists work, never status: a card here
 * means somebody has to act, and a zero means it disappears. A permanent row
 * reading "0 flagged reviews" trains an admin to stop reading the section.
 */
function buildAttention(m: Metrics): AttentionItem[] {
  const dead = (m.queue.dead ?? 0) + (m.queue.failed ?? 0);
  return ([
    {
      key: 'pending',
      count: m.providers.pending,
      label: (n: number) => `${n} provider${n === 1 ? '' : 's'} waiting for verification`,
      to: '/admin/providers?state=pending',
      icon: 'shield' as IconName,
      tone: 'warning' as const,
    },
    {
      key: 'flagged',
      count: m.moderation.flaggedReviews,
      label: (n: number) => `${n} flagged review${n === 1 ? '' : 's'} to moderate`,
      to: '/admin/reviews?status=flagged',
      icon: 'star' as IconName,
      tone: 'warning' as const,
    },
    {
      key: 'tickets',
      count: m.moderation.openTickets,
      label: (n: number) => `${n} open support ticket${n === 1 ? '' : 's'}`,
      to: '/admin/users',
      icon: 'chat' as IconName,
      tone: 'warning' as const,
    },
    {
      key: 'past_due',
      count: m.subscriptions.pastDue,
      label: (n: number) => `${n} subscription${n === 1 ? '' : 's'} past due`,
      to: '/admin/users?role=provider',
      icon: 'receipt' as IconName,
      tone: 'warning' as const,
    },
    {
      key: 'queue',
      count: dead,
      label: (n: number) => `${n} background job${n === 1 ? '' : 's'} failed`,
      to: '/admin/audit',
      icon: 'alert' as IconName,
      tone: 'danger' as const,
    },
  ])
    .filter((item) => item.count > 0)
    .map(({ label, ...rest }) => ({ ...rest, label: label(rest.count) }));
}

function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (!items.length) {
    return (
      <div className="attention attention--clear mb-5">
        <Icon name="check" size={18} />
        <span className="small">Nothing needs your attention right now.</span>
      </div>
    );
  }

  return (
    <section className="mb-5">
      <h2 className="section__title mb-2">Needs attention</h2>
      <div className="stack stack--tight">
        {items.map((item) => (
          <Link key={item.key} to={item.to} className={`attention attention--${item.tone}`}>
            <Icon name={item.icon} size={18} />
            <span className="grow small strong">{item.label}</span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ============================== review queue ============================= */

function ReviewQueue({
  items, pending,
}: { items: Metrics['reviewQueue']; pending: number }) {
  if (!items.length) {
    return (
      <Section title="Review queue">
        <EmptyState
          icon="check"
          title="Queue is clear"
          body="Every submitted verification has been decided."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Review queue"
      action={
        <Link className="section__link" to="/admin/providers?state=pending">
          {pending > items.length ? `All ${pending}` : 'Open'}
        </Link>
      }
    >
      <p className="tiny subtle mb-2">Longest wait first.</p>
      <div className="list-group">
        {items.map((item) => (
          <Link
            key={item.id}
            to={`/admin/providers?state=pending&provider=${item.id}`}
            className="list-item"
          >
            <div className="grow">
              <div className="list-item__title truncate">{item.businessName}</div>
              <div className="list-item__meta truncate">
                {[item.city, item.region].filter(Boolean).join(', ') || 'No location'}
                {' · '}waiting {formatWaiting(item.waitingSince)}
              </div>
            </div>
            <StateBadge state={item.state} />
          </Link>
        ))}
      </div>
    </Section>
  );
}

/* ============================ recent activity =========================== */

const ACTION_LABELS: Record<string, string> = {
  'admin.provider_verification': 'Verification decision',
  'admin.user_suspended': 'Account suspended',
  'admin.user_blocked': 'Account blocked',
  'admin.user_active': 'Account reinstated',
  'admin.review_moderated': 'Review moderated',
  'admin.category_created': 'Category created',
};

function RecentActivity({ entries }: { entries: Metrics['recentActivity'] }) {
  if (!entries.length) {
    return (
      <Section title="Recent admin activity">
        <EmptyState
          icon="shield"
          title="No admin actions yet"
          body="Verifications, suspensions and moderation decisions appear here."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Recent admin activity"
      action={<Link className="section__link" to="/admin/audit">Full log</Link>}
    >
      <div className="list-group">
        {entries.map((entry) => {
          // The metadata carries which lifecycle action it actually was, so a
          // row reads "Verification revoked" rather than the wire-level name.
          const detail = typeof entry.metadata?.action === 'string'
            ? String(entry.metadata.action).replace(/_/g, ' ')
            : null;
          const providerId = typeof entry.metadata?.providerId === 'string'
            ? entry.metadata.providerId
            : entry.entityType === 'provider' ? entry.entityId : null;

          const body = (
            <>
              <div className="grow">
                <div className="small strong">
                  {ACTION_LABELS[entry.action] ?? entry.action.replace(/^admin\./, '').replace(/_/g, ' ')}
                  {detail && <span className="subtle">{` · ${detail}`}</span>}
                </div>
                <div className="tiny subtle truncate">
                  {entry.actorName ?? entry.actorRole ?? 'system'} · {formatRelative(entry.createdAt)}
                  {typeof entry.metadata?.reason === 'string' && entry.metadata.reason
                    ? ` · ${entry.metadata.reason}`
                    : ''}
                </div>
              </div>
              {providerId && <Icon name="chevron" size={16} className="subtle" />}
            </>
          );

          return providerId ? (
            <Link key={entry.id} to={`/admin/providers?provider=${providerId}`} className="list-item">
              {body}
            </Link>
          ) : (
            <div key={entry.id} className="list-item" style={{ cursor: 'default' }}>{body}</div>
          );
        })}
      </div>
    </Section>
  );
}

/* ================================= tiles ================================= */

function Tile({
  value, label, tone,
}: { value: number | string; label: string; tone?: 'brand' | 'sage' | 'accent' }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile--${tone}` : ''}`} style={{ cursor: 'default' }}>
      <span className="stat-tile__value tabular">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </div>
  );
}

function TileLink({
  to, value, label, tone,
}: { to: string; value: number | string; label: string; tone?: 'brand' | 'sage' | 'accent' }) {
  return (
    <Link to={to} className={`stat-tile${tone ? ` stat-tile--${tone}` : ''}`}>
      <span className="stat-tile__value tabular">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </Link>
  );
}

function MetricRow({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="list-item" style={{ cursor: 'default' }}>
      <div className="grow">
        <span className="small">{label}</span>
        {hint && <div className="tiny subtle">{hint}</div>}
      </div>
      <span className="strong tabular">{value}</span>
    </div>
  );
}

/** Re-exported so the states an Overview tile links to stay in one vocabulary. */
export { STATE_LABELS };
