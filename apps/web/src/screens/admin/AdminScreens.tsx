import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { ADMIN_TABS } from '../../components/nav';
import { AccountAction } from '../../components/Shell';
import { Icon } from '../../components/Icon';
import {
  Button, Pill, StatusPill, Avatar, Stars, SkeletonList, ErrorState, EmptyState,
  Modal, TextArea, Banner, LoadMore, RefreshBar, ConfirmDialog,
} from '../../components/ui';
import { usePagedApi, useDebounced } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { useAuth } from '../../state/auth';
import { MIN_REASON_LENGTH } from '../../lib/providerLifecycle';
import { formatDate, formatRelative } from '../../lib/format';

/** Every admin list pages at the same size. */
const PAGE_SIZE = 40;

/* ============================= re-exports ================================ */

/**
 * The Overview and the provider queue outgrew this file — both now carry a
 * state machine, deep links and their own sub-components. They keep their
 * public names here so the router does not have to care where they live.
 */
export { AdminDashboardScreen } from './AdminDashboardScreen';
export { AdminProvidersScreen } from './AdminProvidersScreen';

/** Label/value line used by the user and review detail modals. */
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
  statusReason: string | null;
  statusChangedAt: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  provider: { id: string; businessName: string; verificationStatus: string } | null;
}

export function AdminUsersScreen() {
  const { notify } = useToast();
  // Filters live in the URL so an Overview tile can link straight to the exact
  // list it counted, and so a filtered view is a shareable link.
  const [params, setParams] = useSearchParams();
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<AdminUser | null>(null);
  const debounced = useDebounced(query, 300);

  const users = usePagedApi<AdminUser>(
    (cursor) => api.get('/admin/users', {
      q: debounced || undefined,
      role: role || undefined,
      status: status || undefined,
      cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [debounced, role, status],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

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

      <div className="chip-row mb-3" role="group" aria-label="Filter by role">
        {[
          { value: '', label: 'All roles' },
          { value: 'customer', label: 'Customers' },
          { value: 'provider', label: 'Providers' },
          { value: 'admin', label: 'Admins' },
        ].map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`chip${role === option.value ? ' is-active' : ''}`}
            onClick={() => setParam('role', option.value)}
            aria-pressed={role === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="chip-row mb-4" role="group" aria-label="Filter by account status">
        {[
          { value: '', label: 'Any status' },
          { value: 'active', label: 'Active' },
          { value: 'suspended', label: 'Suspended' },
          { value: 'blocked', label: 'Blocked' },
        ].map((option) => (
          <button
            key={option.value || 'any'}
            type="button"
            className={`chip${status === option.value ? ' is-active' : ''}`}
            onClick={() => setParam('status', option.value)}
            aria-pressed={status === option.value}
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
                <Pill tone={user.status === 'active' ? 'success' : 'danger'}>
                  {user.status.replace(/_/g, ' ')}
                </Pill>
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
  const { sessionAal } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<UserStatusAction | null>(null);

  // Every state-changing admin route is gated on requireMfa, so say so before
  // a reason is typed rather than after a 403 comes back.
  const mfaReady = sessionAal === 'mfa';
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  const setStatus = async (action: UserStatusAction) => {
    if (!user) return;
    setBusy(action.status);
    setConfirming(null);
    try {
      await api.post(`/admin/users/${user.id}/status`, {
        status: action.status, reason: reason.trim(),
      });
      setReason('');
      onDone();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update the user.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;

  const actions = userStatusActions(user.status);

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

      {user.statusReason && user.status !== 'active' && (
        <div className="mb-4">
          <Banner tone="info">
            <strong>Reason on file:</strong> {user.statusReason}
          </Banner>
        </div>
      )}

      {!mfaReady && (
        <div className="mb-4">
          <Banner tone="warning">
            Changing an account status needs a two-factor session. Turn on two-factor
            in your profile and sign in again — until then these actions stay disabled.
          </Banner>
        </div>
      )}

      <TextArea
        label="Reason (required)"
        hint={`At least ${MIN_REASON_LENGTH} characters. Written to the audit log and shown to the user.`}
        error={reason.length > 0 && tooShort
          ? `A bit more detail — ${MIN_REASON_LENGTH} characters minimum.`
          : undefined}
        placeholder="Repeated policy violations after two written warnings."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        disabled={!mfaReady}
      />

      <div className="stack">
        {actions.map((action) => (
          <div key={action.status} className="action-list__item">
            <Button
              block
              variant={action.tone}
              loading={busy === action.status}
              disabled={!mfaReady || busy !== null || tooShort}
              onClick={() => (action.confirmBody ? setConfirming(action) : setStatus(action))}
            >
              {action.label}
            </Button>
            <p className="tiny subtle action-list__hint">{action.description}</p>
          </div>
        ))}
        <Button variant="ghost" block onClick={onClose}>Close</Button>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.label ?? ''}
        body={confirming?.confirmBody ?? ''}
        confirmLabel={confirming?.label ?? 'Confirm'}
        danger={confirming?.tone === 'danger'}
        loading={busy !== null}
        onConfirm={() => confirming && setStatus(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </Modal>
  );
}

/* ------------------------- account status actions ------------------------- */

interface UserStatusAction {
  status: 'active' | 'suspended' | 'blocked';
  label: string;
  description: string;
  tone: 'primary' | 'secondary' | 'danger';
  /** Present when the action needs a second, deliberate confirmation. */
  confirmBody?: string;
}

/**
 * What is legal from each account status. This mirrors the account axis of the
 * provider lifecycle; a customer has no verification axis, so for them it is
 * the whole story. Offering "Suspend" on an already-suspended account was the
 * kind of dead control this replaces.
 */
function userStatusActions(status: string): UserStatusAction[] {
  switch (status) {
    case 'active':
      return [
        {
          status: 'suspended',
          label: 'Suspend account',
          description: 'Temporary. Signs them out everywhere and hides any listings.',
          tone: 'danger',
          confirmBody:
            'Every session ends immediately. Suspension is meant to be undone — '
            + 'use it for anything you expect to reverse.',
        },
        {
          status: 'blocked',
          label: 'Block permanently',
          description: 'Terminal. Sign-in is refused until an admin unblocks them.',
          tone: 'danger',
          confirmBody:
            'This is the strongest action available. Use suspension unless the '
            + 'decision is final.',
        },
      ];
    case 'suspended':
      return [
        {
          status: 'active',
          label: 'Reinstate account',
          description: 'Restores access and anything the suspension took down.',
          tone: 'primary',
        },
        {
          status: 'blocked',
          label: 'Block permanently',
          description: 'Escalates the suspension to a permanent block.',
          tone: 'danger',
          confirmBody: 'Escalating a suspension to a permanent block. Both stay in the history.',
        },
      ];
    case 'blocked':
      return [
        {
          status: 'active',
          label: 'Unblock account',
          description: 'Restores access. The block stays in the history.',
          tone: 'secondary',
          confirmBody:
            'Reversing a permanent block. The original decision and your reason '
            + 'both remain on the record.',
        },
      ];
    default:
      // pending_deletion / deleted: the record is read-only.
      return [];
  }
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
