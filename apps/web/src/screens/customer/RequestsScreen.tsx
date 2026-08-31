import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, Pill, SkeletonList, ErrorState, EmptyState, LoadMore, RefreshBar,
} from '../../components/ui';
import { usePagedApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatRelative, statusLabel, statusTone } from '../../lib/format';
import type { CustomerRequest } from './types';

const FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'new_lead', label: 'Sent' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
];

const PAGE_SIZE = 30;

export function RequestsScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');

  const requests = usePagedApi<CustomerRequest>(
    (cursor) => api.get('/customer/requests', {
      status: status || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [status],
  );

  return (
    <Shell title="Requests" tabs={CUSTOMER_TABS}>
      <div className="chip-row" style={{ marginBottom: 'var(--s4)' }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            className={`chip${status === filter.value ? ' is-active' : ''}`}
            onClick={() => setStatus(filter.value)}
            aria-pressed={status === filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {requests.loading ? (
        <SkeletonList rows={4} />
      ) : requests.error ? (
        <ErrorState message={requests.error} onRetry={requests.reload} />
      ) : !requests.items.length ? (
        <EmptyState
          icon="clipboard"
          title={status ? 'Nothing here yet' : 'No requests yet'}
          body={
            status
              ? 'Try a different filter to see your other requests.'
              : 'When you ask a professional for a quote, it will show up here so you can track it.'
          }
          action={
            !status
              ? <Button icon="search" onClick={() => navigate('/search')}>Find a professional</Button>
              : undefined
          }
        />
      ) : (
        <div className="stack results-stack" aria-busy={requests.refreshing}>
          <RefreshBar active={requests.refreshing} />
          {requests.items.map((request) => (
            <button
              key={request.id}
              type="button"
              className="card-button"
              onClick={() => navigate(`/requests/${request.id}`)}
            >
              <div className="row row--between" style={{ marginBottom: 'var(--s2)' }}>
                <span className="tiny subtle tabular">{request.reference}</span>
                <Pill tone={statusTone(request.status)}>{statusLabel(request.status)}</Pill>
              </div>

              <div className="list-item__title" style={{ marginBottom: 2 }}>{request.title}</div>
              <div className="list-item__meta">{request.provider.businessName}</div>

              <div className="row row--wrap" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
                {request.quoteCount > 0 && (
                  <span className="tiny muted row" style={{ gap: 4 }}>
                    <Icon name="file-text" size={13} /> {request.quoteCount} quote{request.quoteCount === 1 ? '' : 's'}
                  </span>
                )}
                {request.invoiceCount > 0 && (
                  <span className="tiny muted row" style={{ gap: 4 }}>
                    <Icon name="receipt" size={13} /> {request.invoiceCount} invoice{request.invoiceCount === 1 ? '' : 's'}
                  </span>
                )}
                <span className="tiny subtle" style={{ marginLeft: 'auto' }}>
                  {formatRelative(request.createdAt)}
                </span>
              </div>

              {request.canReview && (
                <div style={{ marginTop: 'var(--s3)' }}>
                  <Pill tone="accent"><Icon name="star" size={12} /> Leave a review</Pill>
                </div>
              )}
            </button>
          ))}

          <LoadMore
            hasMore={requests.hasMore}
            loading={requests.loadingMore}
            error={requests.moreError}
            onLoadMore={requests.loadMore}
            count={requests.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </Shell>
  );
}
