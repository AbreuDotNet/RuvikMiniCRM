import { useState } from 'react';
import { Shell } from '../../components/Shell';
import { ADMIN_TABS } from '../../components/nav';
import { AccountAction } from '../../components/Shell';
import { Icon } from '../../components/Icon';
import {
  Button, Pill, StatusPill, Avatar, Stars, SkeletonList, ErrorState, EmptyState,
  Modal, TextArea, Banner, Section, LoadMore, RefreshBar,
} from '../../components/ui';
import { useApi, usePagedApi, useDebounced } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatMoneyCompact, formatDate, formatRelative } from '../../lib/format';

/** Every admin list pages at the same size. */
const PAGE_SIZE = 40;

/* ============================== metrics ================================== */

interface Metrics {
  users: { customers: number; providers: number; suspended: number; newLast30Days: number };
  providers: { pendingVerification: number; verified: number; published: number };
  commerce: {
    jobs: number; completedJobs: number; quotes: number;
    acceptedQuotes: number; invoices: number; gmvCents: number;
  };
  subscriptions: { active: number; pastDue: number; mrrCents: number };
  moderation: { flaggedReviews: number; openTickets: number };
  queue: Record<string, number>;
}

export function AdminDashboardScreen() {
  const metrics = useApi(() => api.get<Metrics>('/admin/metrics'), []);

  return (
    <Shell title="Overview" tabs={ADMIN_TABS} action={<AccountAction />}>
      {metrics.loading ? (
        <SkeletonList rows={4} />
      ) : metrics.error || !metrics.data ? (
        <ErrorState message={metrics.error ?? 'Could not load metrics.'} onRetry={metrics.reload} />
      ) : (
        <>
          {metrics.data.providers.pendingVerification > 0 && (
            <div className="mb-4">
              <Banner tone="warning">
                {metrics.data.providers.pendingVerification} provider
                {metrics.data.providers.pendingVerification === 1 ? '' : 's'} waiting for verification review.
              </Banner>
            </div>
          )}

          <Section title="Platform">
            <div className="stat-grid">
              <Tile value={metrics.data.users.customers} label="Customers" tone="brand" />
              <Tile value={metrics.data.users.providers} label="Providers" tone="sage" />
              <Tile value={metrics.data.users.newLast30Days} label="New (30 days)" />
              <Tile value={metrics.data.users.suspended} label="Suspended" />
            </div>
          </Section>

          <Section title="Revenue">
            <div className="stat-grid">
              <Tile
                value={formatMoneyCompact(metrics.data.subscriptions.mrrCents)}
                label="Monthly recurring"
                tone="accent"
              />
              <Tile
                value={formatMoneyCompact(metrics.data.commerce.gmvCents)}
                label="Invoiced volume"
              />
              <Tile value={metrics.data.subscriptions.active} label="Active plans" />
              <Tile value={metrics.data.subscriptions.pastDue} label="Past due" />
            </div>
          </Section>

          <Section title="Marketplace activity">
            <div className="list-group">
              <MetricRow label="Jobs created" value={metrics.data.commerce.jobs} />
              <MetricRow label="Jobs completed" value={metrics.data.commerce.completedJobs} />
              <MetricRow label="Quotes sent" value={metrics.data.commerce.quotes} />
              <MetricRow
                label="Quotes accepted"
                value={metrics.data.commerce.acceptedQuotes}
                hint={
                  metrics.data.commerce.quotes > 0
                    ? `${Math.round((metrics.data.commerce.acceptedQuotes / metrics.data.commerce.quotes) * 100)}% conversion`
                    : undefined
                }
              />
              <MetricRow label="Invoices issued" value={metrics.data.commerce.invoices} />
            </div>
          </Section>

          <Section title="Background jobs">
            <div className="list-group">
              {Object.entries(metrics.data.queue).length === 0 ? (
                <div className="list-item" style={{ cursor: 'default' }}>
                  <span className="grow small muted">Queue is empty</span>
                </div>
              ) : (
                Object.entries(metrics.data.queue).map(([status, count]) => (
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

          <Section title="Moderation queue">
            <div className="list-group">
              <MetricRow label="Flagged reviews" value={metrics.data.moderation.flaggedReviews} />
              <MetricRow label="Open support tickets" value={metrics.data.moderation.openTickets} />
            </div>
          </Section>
        </>
      )}
    </Shell>
  );
}

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

/* ============================== providers ================================ */

interface AdminProvider {
  id: string;
  businessName: string;
  slug: string;
  city: string | null;
  verificationStatus: string;
  isPublished: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  serviceCount: number;
  subscriptionStatus: string | null;
  createdAt: string;
  owner: { email: string; fullName: string; status: string };
}

const VERIFICATION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'rejected', label: 'Rejected' },
];

export function AdminProvidersScreen() {
  const { notify } = useToast();
  const [filter, setFilter] = useState('');
  const [reviewing, setReviewing] = useState<AdminProvider | null>(null);

  const providers = usePagedApi<AdminProvider>(
    (cursor) => api.get('/admin/providers', {
      verificationStatus: filter || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [filter],
  );

  return (
    <Shell title="Providers" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div className="chip-row mb-4">
        {VERIFICATION_FILTERS.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`chip${filter === option.value ? ' is-active' : ''}`}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {providers.loading ? (
        <SkeletonList rows={5} />
      ) : providers.error ? (
        <ErrorState message={providers.error} onRetry={providers.reload} />
      ) : !providers.items.length ? (
        <EmptyState icon="briefcase" title="No providers here" body="Try another filter." />
      ) : (
        <div className="stack results-stack" aria-busy={providers.refreshing}>
          <RefreshBar active={providers.refreshing} />
          {providers.items.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="card-button"
              onClick={() => setReviewing(provider)}
            >
              <div className="row" style={{ alignItems: 'flex-start', marginBottom: 'var(--s2)' }}>
                <Avatar name={provider.businessName} />
                <div className="grow">
                  <div className="list-item__title truncate">{provider.businessName}</div>
                  <div className="list-item__meta truncate">
                    {provider.owner.email}{provider.city ? ` · ${provider.city}` : ''}
                  </div>
                </div>
                <StatusPill status={provider.verificationStatus} />
              </div>

              <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
                <span className="tiny muted">{provider.serviceCount} listings</span>
                <span className="tiny muted">{provider.completedJobs} jobs</span>
                <Stars rating={provider.ratingAvg} count={provider.ratingCount} size={12} />
                {provider.subscriptionStatus && (
                  <Pill tone={provider.subscriptionStatus === 'active' ? 'success' : 'warning'}>
                    {provider.subscriptionStatus}
                  </Pill>
                )}
                {!provider.isPublished && <Pill tone="neutral">Unlisted</Pill>}
              </div>
            </button>
          ))}

          <LoadMore
            hasMore={providers.hasMore}
            loading={providers.loadingMore}
            error={providers.moreError}
            onLoadMore={providers.loadMore}
            count={providers.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      <VerificationModal
        provider={reviewing}
        onClose={() => setReviewing(null)}
        onDone={() => {
          setReviewing(null);
          notify('Verification updated.', 'success');
          providers.reload();
        }}
      />
    </Shell>
  );
}

function VerificationModal({
  provider, onClose, onDone,
}: { provider: AdminProvider | null; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (status: string) => {
    if (!provider) return;
    setBusy(status);
    try {
      await api.post(`/admin/providers/${provider.id}/verification`, {
        status, note: note.trim() || undefined,
      });
      setNote('');
      onDone();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : 'Could not update verification.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  if (!provider) return null;

  return (
    <Modal open title={provider.businessName} onClose={onClose}>
      <div className="stack stack--tight mb-4">
        <Row label="Owner" value={provider.owner.fullName} />
        <Row label="Email" value={provider.owner.email} />
        <Row label="City" value={provider.city ?? '—'} />
        <Row label="Listings" value={String(provider.serviceCount)} />
        <Row label="Jobs completed" value={String(provider.completedJobs)} />
        <Row label="Joined" value={formatDate(provider.createdAt)} />
        <Row label="Current status" value={provider.verificationStatus} />
      </div>

      <Banner tone="info">
        Verification is a trust signal shown publicly. Confirm licence and insurance
        documents out of band before approving.
      </Banner>

      <div style={{ height: 'var(--s4)' }} />

      <TextArea
        label="Note (shown to the provider)"
        placeholder="Licence and public liability insurance checked."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />

      <div className="stack">
        <Button
          block
          icon="shield"
          loading={busy === 'verified'}
          disabled={busy !== null}
          onClick={() => decide('verified')}
        >
          Approve verification
        </Button>
        <Button
          block
          variant="secondary"
          loading={busy === 'pending'}
          disabled={busy !== null}
          onClick={() => decide('pending')}
        >
          Mark as pending review
        </Button>
        <Button
          block
          variant="danger"
          loading={busy === 'rejected'}
          disabled={busy !== null}
          onClick={() => decide('rejected')}
        >
          Reject
        </Button>
        <Button variant="ghost" block onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row row--between">
      <span className="small muted">{label}</span>
      <span className="small strong" style={{ textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}

/* ================================ users ================================== */

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  provider: { id: string; businessName: string; verificationStatus: string } | null;
}

export function AdminUsersScreen() {
  const { notify } = useToast();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [target, setTarget] = useState<AdminUser | null>(null);
  const debounced = useDebounced(query, 300);

  const users = usePagedApi<AdminUser>(
    (cursor) => api.get('/admin/users', {
      q: debounced || undefined, role: role || undefined,
      cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [debounced, role],
  );

  return (
    <Shell title="Users" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div className="search-input-wrap mb-3">
        <Icon name="search" size={19} />
        <input
          className="input"
          type="search"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
      </div>

      <div className="chip-row mb-4">
        {[
          { value: '', label: 'All' },
          { value: 'customer', label: 'Customers' },
          { value: 'provider', label: 'Providers' },
          { value: 'admin', label: 'Admins' },
        ].map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`chip${role === option.value ? ' is-active' : ''}`}
            onClick={() => setRole(option.value)}
            aria-pressed={role === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {users.loading ? (
        <SkeletonList rows={5} />
      ) : users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : !users.items.length ? (
        <EmptyState icon="users" title="No users found" body="Try a different search or filter." />
      ) : (
        <div className="results-stack" aria-busy={users.refreshing}>
          <RefreshBar active={users.refreshing} />
          <div className="list-group">
          {users.items.map((user) => (
            <button
              key={user.id}
              type="button"
              className="list-item"
              onClick={() => setTarget(user)}
            >
              <Avatar name={user.fullName} size="sm" />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="list-item__title truncate">{user.fullName}</span>
                  {user.mfaEnabled && <Icon name="lock" size={12} className="subtle" />}
                </div>
                <div className="list-item__meta truncate">{user.email}</div>
              </div>
              <div className="list-item__trail">
                <Pill tone={user.status === 'active' ? 'success' : 'danger'}>{user.status}</Pill>
                <div className="tiny subtle" style={{ marginTop: 4, textTransform: 'capitalize' }}>
                  {user.role}
                </div>
              </div>
            </button>
          ))}
          </div>

          <LoadMore
            hasMore={users.hasMore}
            loading={users.loadingMore}
            error={users.moreError}
            onLoadMore={users.loadMore}
            count={users.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      <UserModal
        user={target}
        onClose={() => setTarget(null)}
        onDone={() => { setTarget(null); notify('User updated.', 'success'); users.reload(); }}
      />
    </Shell>
  );
}

function UserModal({
  user, onClose, onDone,
}: { user: AdminUser | null; onClose: () => void; onDone: () => void }) {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const setStatus = async (status: 'active' | 'suspended') => {
    if (!user) return;
    if (!reason.trim()) {
      notify('Give a reason — it is written to the audit log and shown to the user.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/status`, { status, reason: reason.trim() });
      setReason('');
      onDone();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update the user.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <Modal open title={user.fullName} onClose={onClose}>
      <div className="stack stack--tight mb-4">
        <Row label="Email" value={user.email} />
        <Row label="Role" value={user.role} />
        <Row label="Status" value={user.status} />
        <Row label="Two-factor" value={user.mfaEnabled ? 'On' : 'Off'} />
        <Row label="Last sign-in" value={user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'} />
        <Row label="Joined" value={formatDate(user.createdAt)} />
        {user.provider && <Row label="Business" value={user.provider.businessName} />}
      </div>

      <Banner tone="warning">
        Suspending signs the user out everywhere immediately and hides their listings.
        This action requires two-factor and is written to the audit log.
      </Banner>

      <div style={{ height: 'var(--s4)' }} />

      <TextArea
        label="Reason (required)"
        placeholder="Repeated policy violations after two warnings."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />

      <div className="stack">
        {user.status === 'active' ? (
          <Button block variant="danger" loading={busy} onClick={() => setStatus('suspended')}>
            Suspend account
          </Button>
        ) : (
          <Button block loading={busy} onClick={() => setStatus('active')}>
            Reinstate account
          </Button>
        )}
        <Button variant="ghost" block onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/* =============================== reviews ================================= */

interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  status: string;
  moderationNote: string | null;
  createdAt: string;
  providerName: string;
  customerName: string;
  jobReference: string;
}

export function AdminReviewsScreen() {
  const { notify } = useToast();
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<AdminReview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reviews = usePagedApi<AdminReview>(
    (cursor) => api.get('/admin/reviews', {
      status: filter || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [filter],
  );

  const moderate = async (status: string) => {
    if (!target) return;
    setBusy(status);
    try {
      await api.post(`/admin/reviews/${target.id}/moderate`, { status });
      notify('Review moderated.', 'success');
      setTarget(null);
      reviews.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not moderate that review.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell title="Reviews" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div className="chip-row mb-4">
        {[
          { value: '', label: 'All' },
          { value: 'published', label: 'Published' },
          { value: 'flagged', label: 'Flagged' },
          { value: 'removed', label: 'Removed' },
        ].map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`chip${filter === option.value ? ' is-active' : ''}`}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      {reviews.loading ? (
        <SkeletonList rows={4} />
      ) : reviews.error ? (
        <ErrorState message={reviews.error} onRetry={reviews.reload} />
      ) : !reviews.items.length ? (
        <EmptyState icon="star" title="No reviews here" body="Try another filter." />
      ) : (
        <div className="stack results-stack" aria-busy={reviews.refreshing}>
          <RefreshBar active={reviews.refreshing} />
          {reviews.items.map((review) => (
            <button
              key={review.id}
              type="button"
              className="card-button"
              onClick={() => setTarget(review)}
            >
              <div className="row row--between mb-2">
                <Stars rating={review.rating} size={14} />
                <StatusPill status={review.status} />
              </div>
              {review.comment && (
                <p className="small" style={{ marginBottom: 'var(--s2)', lineHeight: 1.55 }}>
                  {review.comment}
                </p>
              )}
              <div className="tiny subtle">
                {review.customerName} → {review.providerName} · {formatRelative(review.createdAt)}
              </div>
            </button>
          ))}

          <LoadMore
            hasMore={reviews.hasMore}
            loading={reviews.loadingMore}
            error={reviews.moreError}
            onLoadMore={reviews.loadMore}
            count={reviews.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      <Modal
        open={target !== null}
        title="Moderate review"
        onClose={() => setTarget(null)}
      >
        {target && (
          <>
            <div className="card card--pad mb-4">
              <Stars rating={target.rating} size={16} />
              {target.comment && (
                <p className="small" style={{ marginTop: 'var(--s2)', lineHeight: 1.55 }}>
                  {target.comment}
                </p>
              )}
            </div>

            <div className="stack stack--tight mb-4">
              <Row label="Customer" value={target.customerName} />
              <Row label="Provider" value={target.providerName} />
              <Row label="Job" value={target.jobReference} />
            </div>

            <Banner tone="info">
              Removing a review recalculates the provider's public rating immediately.
            </Banner>

            <div style={{ height: 'var(--s4)' }} />

            <div className="stack">
              <Button
                block
                variant="danger"
                loading={busy === 'removed'}
                disabled={busy !== null}
                onClick={() => moderate('removed')}
              >
                Remove review
              </Button>
              <Button
                block
                variant="secondary"
                loading={busy === 'flagged'}
                disabled={busy !== null}
                onClick={() => moderate('flagged')}
              >
                Flag for follow-up
              </Button>
              <Button
                block
                variant="ghost"
                loading={busy === 'published'}
                disabled={busy !== null}
                onClick={() => moderate('published')}
              >
                Keep published
              </Button>
            </div>
          </>
        )}
      </Modal>
    </Shell>
  );
}

/* =============================== audit log =============================== */

interface AuditEntry {
  id: number;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function AdminAuditScreen() {
  const [integrity, setIntegrity] = useState<{ ok: boolean; brokenAtId?: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const { notify } = useToast();

  // Audit rows are keyed on a bigserial id, not (created_at, id) like every
  // other list, so this adapts its before/nextBefore shape to the shared one.
  const logs = usePagedApi<AuditEntry>(
    async (cursor) => {
      const page = await api.get<{
        data: AuditEntry[]; nextBefore: number | null; hasMore: boolean;
      }>('/admin/audit-logs', { before: cursor ?? undefined, limit: PAGE_SIZE });
      return {
        data: page.data,
        pagination: {
          nextCursor: page.nextBefore === null ? null : String(page.nextBefore),
          hasMore: page.hasMore,
          limit: PAGE_SIZE,
        },
      };
    },
    [],
  );

  const verify = async () => {
    setChecking(true);
    try {
      setIntegrity(await api.get<{ ok: boolean; brokenAtId?: number }>('/admin/audit-logs/integrity'));
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : 'Integrity check needs a two-factor session.',
        'error',
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <Shell title="Audit log" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div className="card card--pad mb-4">
        <div className="row row--between mb-3">
          <div>
            <div className="strong small">Tamper-evident chain</div>
            <div className="tiny subtle">
              Each entry hashes the previous one, so an edit or deletion is detectable.
            </div>
          </div>
          {integrity && (
            <Pill tone={integrity.ok ? 'success' : 'danger'}>
              {integrity.ok ? 'Intact' : 'Broken'}
            </Pill>
          )}
        </div>
        <Button variant="secondary" block icon="shield" loading={checking} onClick={verify}>
          Verify chain integrity
        </Button>
        {integrity && !integrity.ok && (
          <div className="mt-3">
            <Banner tone="danger">
              Chain broken at entry #{integrity.brokenAtId}. Investigate immediately.
            </Banner>
          </div>
        )}
      </div>

      {logs.loading ? (
        <SkeletonList rows={6} />
      ) : logs.error ? (
        <ErrorState message={logs.error} onRetry={logs.reload} />
      ) : !logs.items.length ? (
        <EmptyState icon="shield" title="No audit entries" body="Sensitive actions are recorded here." />
      ) : (
        <div className="results-stack" aria-busy={logs.refreshing}>
          <RefreshBar active={logs.refreshing} />
          <div className="list-group">
          {logs.items.map((entry) => (
            <div key={entry.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <div
                className="avatar avatar--sm"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-subtle)' }}
              >
                <Icon name="shield" size={14} />
              </div>
              <div className="grow">
                <div className="small strong" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {entry.action}
                </div>
                <div className="tiny subtle">
                  {entry.actorRole ?? 'system'}
                  {entry.entityType ? ` · ${entry.entityType}` : ''} · {formatRelative(entry.createdAt)}
                </div>
                {Object.keys(entry.metadata ?? {}).length > 0 && (
                  <div className="tiny subtle truncate" style={{ marginTop: 2 }}>
                    {JSON.stringify(entry.metadata)}
                  </div>
                )}
              </div>
              <span className="tiny subtle tabular">#{entry.id}</span>
            </div>
          ))}
          </div>

          <LoadMore
            hasMore={logs.hasMore}
            loading={logs.loadingMore}
            error={logs.moreError}
            onLoadMore={logs.loadMore}
            count={logs.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </Shell>
  );
}
