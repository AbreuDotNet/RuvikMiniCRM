import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shell, AccountAction } from '../../components/Shell';
import { ADMIN_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, Pill, Avatar, Stars, SkeletonList, ErrorState, EmptyState,
  Modal, TextArea, Banner, LoadMore, RefreshBar, ConfirmDialog,
} from '../../components/ui';
import { useApi, usePagedApi, useDebounced } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { useAuth } from '../../state/auth';
import { formatDate, formatRelative, formatWaiting } from '../../lib/format';
import {
  STATE_LABELS, STATE_MEANING, STATE_TONES, MIN_REASON_LENGTH,
  type EffectiveState,
} from '../../lib/providerLifecycle';

const PAGE_SIZE = 40;

/* ================================= types ================================= */

interface AdminProvider {
  id: string;
  businessName: string;
  slug: string;
  city: string | null;
  region: string | null;
  state: EffectiveState;
  verificationStatus: string;
  verificationNote: string | null;
  verifiedAt: string | null;
  waitingSince: string;
  isPublished: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  serviceCount: number;
  subscriptionStatus: string | null;
  createdAt: string;
  owner: {
    email: string;
    fullName: string;
    status: string;
    statusReason: string | null;
    statusChangedAt?: string | null;
  };
}

/** Exactly what the server says is legal from the provider's current state. */
interface AvailableAction {
  action: string;
  label: string;
  description: string;
  tone: 'primary' | 'secondary' | 'danger';
  requiresReason: boolean;
  requiresConfirmation: boolean;
  confirmBody: string | null;
}

interface HistoryEntry {
  id: number;
  axis: 'verification' | 'account';
  action: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}

interface ProviderDocument {
  id: string;
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  scanStatus: 'pending' | 'clean' | 'infected' | 'error';
  uploadedAt: string;
}

interface AdminProviderDetail extends AdminProvider {
  tagline: string | null;
  bio: string | null;
  phone: string | null;
  addressLine: string | null;
  postalCode: string | null;
  country: string;
  yearsExperience: number | null;
  certifications: unknown[];
  jobCount: number;
  flaggedReviewCount: number;
  owner: AdminProvider['owner'] & {
    id: string;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
    joinedAt: string;
  };
  availableActions: AvailableAction[];
  history: HistoryEntry[];
  documents: ProviderDocument[];
}

/* ================================ filters ================================ */

/**
 * Ordered by how often an admin needs them, not alphabetically. The two queue
 * states come first because they are the only ones that represent work.
 */
const STATE_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'info_requested', label: 'Info requested' },
  { value: '', label: 'All' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Not submitted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'blocked', label: 'Blocked' },
];

export function AdminProvidersScreen() {
  const { notify } = useToast();
  // The filter lives in the URL so an Overview tile can deep-link into the
  // exact list it counted, and so a review is a shareable link.
  const [params, setParams] = useSearchParams();
  const filter = params.get('state') ?? '';
  const openId = params.get('provider');

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);

  // A queue is worked oldest-first; every other view reads as a directory and
  // is most useful newest-first.
  const sort = filter === 'pending' || filter === 'info_requested' ? 'waiting' : 'newest';

  const providers = usePagedApi<AdminProvider>(
    (cursor) => api.get('/admin/providers', {
      state: filter || undefined,
      q: debounced || undefined,
      sort,
      cursor: cursor ?? undefined,
      limit: PAGE_SIZE,
    }),
    [filter, debounced, sort],
  );

  const setFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('state', value); else next.delete('state');
    next.delete('provider');
    setParams(next, { replace: true });
  };

  const openProvider = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('provider', id); else next.delete('provider');
    setParams(next, { replace: true });
  };

  return (
    <Shell title="Providers" tabs={ADMIN_TABS} action={<AccountAction />}>
      <div className="search-input-wrap mb-3">
        <Icon name="search" size={19} />
        <input
          className="input"
          type="search"
          placeholder="Business, owner or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search providers"
        />
      </div>

      <div className="chip-row mb-4" role="group" aria-label="Filter by status">
        {STATE_FILTERS.map((option) => (
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

      {sort === 'waiting' && !providers.loading && providers.items.length > 0 && (
        <p className="tiny subtle mb-3">Longest wait first.</p>
      )}

      {providers.loading ? (
        <SkeletonList rows={5} />
      ) : providers.error ? (
        <ErrorState message={providers.error} onRetry={providers.reload} />
      ) : !providers.items.length ? (
        <EmptyState
          icon={filter === 'pending' ? 'check' : 'briefcase'}
          title={emptyTitle(filter, debounced)}
          body={emptyBody(filter, debounced)}
        />
      ) : (
        <div className="stack results-stack" aria-busy={providers.refreshing}>
          <RefreshBar active={providers.refreshing} />
          {providers.items.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onOpen={() => openProvider(provider.id)}
            />
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

      {openId && (
        <ProviderReview
          providerId={openId}
          onClose={() => openProvider(null)}
          onChanged={(message) => {
            notify(message, 'success');
            providers.reload();
          }}
        />
      )}
    </Shell>
  );
}

function emptyTitle(filter: string, query: string): string {
  if (query) return 'Nothing matches that search';
  if (filter === 'pending') return 'The review queue is clear';
  if (filter === 'info_requested') return 'Nobody is waiting on us';
  return 'No providers here';
}

function emptyBody(filter: string, query: string): string {
  if (query) return 'Try part of the business name, the owner’s name, or their email.';
  if (filter === 'pending') return 'Every submitted verification has been decided.';
  if (filter === 'info_requested') return 'No provider has an outstanding request for information.';
  return 'Try another status filter.';
}

/* ============================== list rows ================================ */

function ProviderCard({ provider, onOpen }: { provider: AdminProvider; onOpen: () => void }) {
  const needsWork = provider.state === 'pending' || provider.state === 'info_requested';

  return (
    <button type="button" className="card-button" onClick={onOpen}>
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 'var(--s2)' }}>
        <Avatar name={provider.businessName} />
        <div className="grow">
          <div className="list-item__title truncate">{provider.businessName}</div>
          <div className="list-item__meta truncate">
            {provider.owner.email}
            {provider.city ? ` · ${provider.city}` : ''}
            {provider.region ? `, ${provider.region}` : ''}
          </div>
        </div>
        <StateBadge state={provider.state} />
      </div>

      <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
        {needsWork ? (
          <span className="tiny strong" style={{ color: 'var(--warning)' }}>
            Waiting {formatWaiting(provider.waitingSince)}
          </span>
        ) : (
          <span className="tiny muted">{provider.serviceCount} listings</span>
        )}
        <span className="tiny muted">{provider.completedJobs} jobs</span>
        {provider.ratingCount > 0 && (
          <Stars rating={provider.ratingAvg} count={provider.ratingCount} size={12} />
        )}
        {provider.subscriptionStatus && (
          <Pill tone={provider.subscriptionStatus === 'active' ? 'success' : 'warning'}>
            {provider.subscriptionStatus.replace(/_/g, ' ')}
          </Pill>
        )}
        {!provider.isPublished && <Pill tone="neutral">Unlisted</Pill>}
      </div>

      {/* The reason an account was stopped belongs on the row: an admin
          scanning a suspended list should not have to open each one to find
          out why it is there. */}
      {provider.owner.statusReason && provider.state !== 'verified' && (
        <p className="tiny subtle truncate" style={{ marginTop: 'var(--s2)' }}>
          {provider.owner.statusReason}
        </p>
      )}
    </button>
  );
}

export function StateBadge({ state }: { state: EffectiveState }) {
  return <Pill tone={STATE_TONES[state] ?? 'neutral'}>{STATE_LABELS[state] ?? state}</Pill>;
}

/* ============================ review drawer ============================== */

function ProviderReview({
  providerId, onClose, onChanged,
}: {
  providerId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { sessionAal } = useAuth();
  const detail = useApi(
    () => api.get<AdminProviderDetail>(`/admin/providers/${providerId}`),
    [providerId],
  );

  const [pending, setPending] = useState<AvailableAction | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every state-changing admin route is gated on requireMfa. Knowing that up
  // front turns a 403 after typing a reason into a message before starting.
  const mfaReady = sessionAal === 'mfa';

  const reasonTooShort =
    Boolean(pending?.requiresReason) && reason.trim().length < MIN_REASON_LENGTH;

  const reset = () => {
    setPending(null);
    setReason('');
    setConfirming(false);
    setError(null);
  };

  const run = async (spec: AvailableAction) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/providers/${providerId}/actions`, {
        action: spec.action,
        reason: reason.trim() || undefined,
      });
      reset();
      onChanged(`${spec.label} — done.`);
      onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'That did not go through.';
      setError(message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const start = (spec: AvailableAction) => {
    setError(null);
    if (spec.requiresReason && reason.trim().length < MIN_REASON_LENGTH) {
      setPending(spec);
      return;
    }
    if (spec.requiresConfirmation) {
      setPending(spec);
      setConfirming(true);
      return;
    }
    setPending(spec);
    void run(spec);
  };

  const d = detail.data;

  return (
    <>
      <Modal open title={d?.businessName ?? 'Provider'} onClose={onClose}>
        {detail.loading ? (
          <SkeletonList rows={4} />
        ) : detail.error || !d ? (
          <ErrorState message={detail.error ?? 'Provider not found.'} onRetry={detail.reload} />
        ) : (
          <>
            <StateSummary detail={d} />

            <Facts detail={d} />

            <DocumentList documents={d.documents} />

            <History entries={d.history} />

            {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

            {!mfaReady && (
              <div className="mb-4">
                <Banner tone="warning">
                  Changing a provider’s status needs a two-factor session. Turn on
                  two-factor in your profile and sign in again — until then the
                  actions below stay disabled.
                </Banner>
              </div>
            )}

            {/* The reason box appears once, above the actions, rather than
                inside each one: an admin usually knows why before deciding
                which button to press. */}
            {d.availableActions.some((a) => a.requiresReason) && (
              <TextArea
                label={pending?.requiresReason ? `Reason for “${pending.label}”` : 'Reason'}
                hint={`Stored in the provider history${
                  pending?.requiresReason ? ` · at least ${MIN_REASON_LENGTH} characters` : ''
                }. Required for anything that stops or reverses an account.`}
                error={pending?.requiresReason && reasonTooShort && reason.length > 0
                  ? `A bit more detail — ${MIN_REASON_LENGTH} characters minimum.`
                  : undefined}
                placeholder="Licence number could not be matched against the state register."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                disabled={!mfaReady}
              />
            )}

            <ActionList
              actions={d.availableActions}
              disabled={!mfaReady || busy}
              busyAction={busy ? pending?.action ?? null : null}
              blockedReason={
                pending?.requiresReason && reasonTooShort
                  ? `Write a reason of at least ${MIN_REASON_LENGTH} characters first.`
                  : null
              }
              onPick={start}
            />

            <Button variant="ghost" block onClick={onClose}>Close</Button>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirming && pending !== null}
        title={pending?.label ?? ''}
        body={pending?.confirmBody ?? 'This cannot be undone from here.'}
        confirmLabel={pending?.label ?? 'Confirm'}
        danger={pending?.tone === 'danger'}
        loading={busy}
        onConfirm={() => pending && run(pending)}
        onCancel={() => { setConfirming(false); setPending(null); }}
      />
    </>
  );
}

/* --------------------------- drawer sections ----------------------------- */

function StateSummary({ detail }: { detail: AdminProviderDetail }) {
  const reason = detail.owner.statusReason ?? detail.verificationNote;
  const showReason =
    Boolean(reason) && detail.state !== 'verified' && detail.state !== 'unverified';

  return (
    <div className="state-summary mb-4">
      <div className="row row--between mb-2">
        <StateBadge state={detail.state} />
        {detail.isPublished
          ? <Pill tone="success">Listed publicly</Pill>
          : <Pill tone="neutral">Unlisted</Pill>}
      </div>
      <p className="small" style={{ margin: 0 }}>{STATE_MEANING[detail.state]}</p>
      {showReason && (
        <p className="tiny subtle" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
          <strong>Reason on file:</strong> {reason}
        </p>
      )}
      {detail.state === 'verified' && detail.verifiedAt && (
        <p className="tiny subtle" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
          Verified {formatDate(detail.verifiedAt)}.
        </p>
      )}
      {(detail.state === 'pending' || detail.state === 'info_requested') && (
        <p className="tiny subtle" style={{ marginTop: 'var(--s2)', marginBottom: 0 }}>
          Waiting {formatWaiting(detail.waitingSince)}, since {formatDate(detail.waitingSince)}.
        </p>
      )}
    </div>
  );
}

function Facts({ detail }: { detail: AdminProviderDetail }) {
  return (
    <div className="stack stack--tight mb-4">
      <Fact label="Owner" value={detail.owner.fullName} />
      <Fact label="Email" value={detail.owner.email} />
      {detail.phone && <Fact label="Phone" value={detail.phone} />}
      <Fact
        label="Location"
        value={[detail.city, detail.region, detail.postalCode].filter(Boolean).join(', ') || '—'}
      />
      <Fact label="Listings" value={String(detail.serviceCount)} />
      <Fact label="Jobs" value={`${detail.completedJobs} completed of ${detail.jobCount}`} />
      <Fact
        label="Rating"
        value={detail.ratingCount ? `${detail.ratingAvg.toFixed(1)} from ${detail.ratingCount}` : 'No reviews'}
      />
      {detail.flaggedReviewCount > 0 && (
        <Fact label="Flagged reviews" value={String(detail.flaggedReviewCount)} tone="danger" />
      )}
      <Fact label="Subscription" value={detail.subscriptionStatus?.replace(/_/g, ' ') ?? 'None'} />
      <Fact label="Two-factor" value={detail.owner.mfaEnabled ? 'On' : 'Off'} />
      <Fact
        label="Last sign-in"
        value={detail.owner.lastLoginAt ? formatRelative(detail.owner.lastLoginAt) : 'Never'}
      />
      <Fact label="Joined" value={formatDate(detail.createdAt)} />
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="row row--between">
      <span className="small muted">{label}</span>
      <span
        className="small strong"
        style={{ textAlign: 'right', color: tone === 'danger' ? 'var(--danger)' : undefined }}
      >
        {value}
      </span>
    </div>
  );
}

function DocumentList({ documents }: { documents: ProviderDocument[] }) {
  if (!documents.length) {
    return (
      <div className="mb-4">
        <Banner tone="info">
          No documents uploaded. Confirm licence and insurance out of band before approving.
        </Banner>
      </div>
    );
  }

  const scanning = documents.filter((d) => d.scanStatus === 'pending').length;
  const infected = documents.filter((d) => d.scanStatus === 'infected').length;

  return (
    <section className="mb-4">
      <h3 className="section__title mb-2">Documents</h3>
      {infected > 0 && (
        <div className="mb-2">
          <Banner tone="danger">
            {infected} upload{infected === 1 ? '' : 's'} failed the malware scan. Do not open.
          </Banner>
        </div>
      )}
      {scanning > 0 && infected === 0 && (
        <div className="mb-2">
          <Banner tone="warning">
            {scanning} upload{scanning === 1 ? ' is' : 's are'} still being scanned.
          </Banner>
        </div>
      )}
      <div className="list-group">
        {documents.map((doc) => (
          <div key={doc.id} className="list-item" style={{ cursor: 'default' }}>
            <div className="grow">
              <div className="small truncate">{doc.name ?? 'Untitled upload'}</div>
              <div className="tiny subtle">
                {(doc.sizeBytes / 1024).toFixed(0)} KB · {formatDate(doc.uploadedAt)}
              </div>
            </div>
            <Pill tone={doc.scanStatus === 'clean' ? 'success' : doc.scanStatus === 'infected' ? 'danger' : 'warning'}>
              {doc.scanStatus}
            </Pill>
          </div>
        ))}
      </div>
    </section>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!entries.length) return null;

  const shown = expanded ? entries : entries.slice(0, 3);

  return (
    <section className="mb-4">
      <div className="row row--between mb-2">
        <h3 className="section__title" style={{ margin: 0 }}>History</h3>
        {entries.length > 3 && (
          <button type="button" className="section__link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : `All ${entries.length}`}
          </button>
        )}
      </div>
      <div className="timeline">
        {shown.map((entry) => (
          <div key={entry.id} className="timeline__item">
            <div className="timeline__dot timeline__dot--done" />
            <div className="grow">
              <div className="timeline__label">
                {historyLabel(entry)}
              </div>
              <div className="timeline__time">
                {entry.actorName ?? 'System'} · {formatRelative(entry.createdAt)}
              </div>
              {entry.reason && (
                <p className="tiny subtle" style={{ marginTop: 2, marginBottom: 0 }}>
                  {entry.reason}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  approve: 'Verification approved',
  overturn: 'Rejection overturned, verified',
  request_info: 'More information requested',
  reject: 'Verification rejected',
  reopen: 'Sent to the review queue',
  revoke: 'Verification revoked',
  suspend: 'Account suspended',
  reinstate: 'Account reinstated',
  block: 'Account blocked',
  unblock: 'Account unblocked',
};

function historyLabel(entry: HistoryEntry): string {
  return HISTORY_LABELS[entry.action]
    ?? `${entry.fromStatus ?? '?'} → ${entry.toStatus}`;
}

function ActionList({
  actions, disabled, busyAction, blockedReason, onPick,
}: {
  actions: AvailableAction[];
  disabled: boolean;
  busyAction: string | null;
  blockedReason: string | null;
  onPick: (spec: AvailableAction) => void;
}) {
  // Constructive first, destructive last, so the dangerous buttons are never
  // where a thumb lands by default.
  const ordered = useMemo(() => {
    const rank = { primary: 0, secondary: 1, danger: 2 } as const;
    return [...actions].sort((a, b) => rank[a.tone] - rank[b.tone]);
  }, [actions]);

  if (!ordered.length) {
    return (
      <div className="mb-4">
        <Banner tone="info">
          There is nothing to do here. This account is closed and its record is read-only.
        </Banner>
      </div>
    );
  }

  return (
    <div className="action-list mb-4">
      {blockedReason && <p className="tiny subtle mb-2">{blockedReason}</p>}
      {ordered.map((spec) => (
        <div key={spec.action} className="action-list__item">
          <Button
            block
            variant={spec.tone === 'primary' ? 'primary' : spec.tone === 'danger' ? 'danger' : 'secondary'}
            loading={busyAction === spec.action}
            disabled={disabled}
            onClick={() => onPick(spec)}
          >
            {spec.label}
          </Button>
          <p className="tiny subtle action-list__hint">{spec.description}</p>
        </div>
      ))}
    </div>
  );
}
