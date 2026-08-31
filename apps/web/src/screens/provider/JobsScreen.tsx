import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, StatusPill, Avatar, SkeletonList, ErrorState, EmptyState, LoadMore, RefreshBar,
} from '../../components/ui';
import { usePagedApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatRelative, formatDateTime } from '../../lib/format';

interface JobRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledStart: string | null;
  completedAt: string | null;
  city: string | null;
  createdAt: string;
  client: { id: string; fullName: string; phone: string | null };
  quoteCount: number;
  invoiceCount: number;
}

const PIPELINE: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'new_lead', label: 'New leads' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'approved', label: 'Approved' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

const PAGE_SIZE = 30;

export function JobsScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';

  const jobs = usePagedApi<JobRow>(
    (cursor) => api.get('/provider/jobs', {
      status: status || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [status],
  );

  const setStatus = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
  };

  return (
    <Shell
      title="Jobs"
      tabs={PROVIDER_TABS}
      action={
        <button
          type="button"
          className="app-header__action"
          onClick={() => navigate('/jobs/new')}
          aria-label="Create a job"
        >
          <Icon name="plus" size={22} />
        </button>
      }
    >
      <div className="chip-row mb-4">
        {PIPELINE.map((stage) => (
          <button
            key={stage.value || 'all'}
            type="button"
            className={`chip${status === stage.value ? ' is-active' : ''}`}
            onClick={() => setStatus(stage.value)}
            aria-pressed={status === stage.value}
          >
            {stage.label}
          </button>
        ))}
      </div>

      {jobs.loading ? (
        <SkeletonList rows={5} />
      ) : jobs.error ? (
        <ErrorState message={jobs.error} onRetry={jobs.reload} />
      ) : !jobs.items.length ? (
        <EmptyState
          icon="briefcase"
          title={status ? 'No jobs at this stage' : 'No jobs yet'}
          body={
            status
              ? 'Try another stage in the pipeline above.'
              : 'New customer requests land here automatically. You can also add a job for a client you already work with.'
          }
          action={<Button icon="plus" onClick={() => navigate('/jobs/new')}>Add a job</Button>}
        />
      ) : (
        <div className="stack results-stack" aria-busy={jobs.refreshing}>
          <RefreshBar active={jobs.refreshing} />
          {jobs.items.map((job) => (
            <button
              key={job.id}
              type="button"
              className="card-button"
              onClick={() => navigate(`/jobs/${job.id}`)}
            >
              <div className="row row--between mb-2">
                <span className="tiny subtle tabular">{job.reference}</span>
                <StatusPill status={job.status} />
              </div>

              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Avatar name={job.client.fullName} size="sm" />
                <div className="grow">
                  <div className="list-item__title">{job.title}</div>
                  <div className="list-item__meta truncate">
                    {job.client.fullName}{job.city ? ` · ${job.city}` : ''}
                  </div>
                </div>
              </div>

              <div className="row row--wrap" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
                {job.scheduledStart && (
                  <span className="tiny muted row" style={{ gap: 4 }}>
                    <Icon name="calendar" size={13} /> {formatDateTime(job.scheduledStart)}
                  </span>
                )}
                {job.quoteCount > 0 && (
                  <span className="tiny muted row" style={{ gap: 4 }}>
                    <Icon name="file-text" size={13} /> {job.quoteCount}
                  </span>
                )}
                {job.invoiceCount > 0 && (
                  <span className="tiny muted row" style={{ gap: 4 }}>
                    <Icon name="receipt" size={13} /> {job.invoiceCount}
                  </span>
                )}
                <span className="tiny subtle" style={{ marginLeft: 'auto' }}>
                  {formatRelative(job.createdAt)}
                </span>
              </div>
            </button>
          ))}

          <LoadMore
            hasMore={jobs.hasMore}
            loading={jobs.loadingMore}
            error={jobs.moreError}
            onLoadMore={jobs.loadMore}
            count={jobs.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </Shell>
  );
}
