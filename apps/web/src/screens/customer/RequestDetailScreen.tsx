import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, Pill, StatusPill, Avatar, SkeletonList, ErrorState, Modal, TextArea, Banner,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatMoney, formatDate, formatDateTime, formatRelative } from '../../lib/format';

interface RequestDetail {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  addressLine: string | null;
  city: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  canReview: boolean;
  myReview: { id: string; rating: number; comment: string | null } | null;
  provider: {
    id: string; slug: string; businessName: string;
    phone: string | null; ratingAvg: number;
  };
  quotes: Array<{
    id: string; number: string; status: string; totalCents: number;
    currency: string; validUntil: string | null; sentAt: string | null; acceptedAt: string | null;
  }>;
  invoices: Array<{
    id: string; number: string; status: string; totalCents: number;
    amountPaidCents: number; currency: string; dueDate: string | null;
  }>;
  comments: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
}

export function RequestDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [reviewOpen, setReviewOpen] = useState(false);

  const request = useApi(() => api.get<RequestDetail>(`/customer/requests/${id}`), [id]);

  if (request.loading) {
    return <Shell title="Request" tabs={CUSTOMER_TABS} back><SkeletonList rows={3} /></Shell>;
  }
  if (request.error || !request.data) {
    return (
      <Shell title="Request" tabs={CUSTOMER_TABS} back>
        <ErrorState message={request.error ?? 'Request not found.'} onRetry={request.reload} />
      </Shell>
    );
  }

  const r = request.data;
  const openQuote = r.quotes.find((q) => q.status === 'sent');

  return (
    <Shell title={r.reference} tabs={CUSTOMER_TABS} back="/requests">
      <div className="card card--pad" style={{ marginBottom: 'var(--s4)' }}>
        <div className="row row--between" style={{ marginBottom: 'var(--s3)' }}>
          <StatusPill status={r.status} />
          <span className="tiny subtle">{formatRelative(r.createdAt)}</span>
        </div>

        <h2 style={{ marginBottom: 'var(--s2)' }}>{r.title}</h2>
        {r.description && <p className="muted small" style={{ lineHeight: 1.6 }}>{r.description}</p>}

        <hr className="divider" />

        <button
          type="button"
          className="row"
          style={{ width: '100%', border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
          onClick={() => navigate(`/providers/${r.provider.slug}`)}
        >
          <Avatar name={r.provider.businessName} size="sm" />
          <div className="grow">
            <div className="strong small">{r.provider.businessName}</div>
            <div className="tiny subtle">View profile</div>
          </div>
          <Icon name="chevron" size={16} className="subtle" />
        </button>

        {r.scheduledStart && (
          <>
            <hr className="divider" />
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <Icon name="calendar" size={18} className="muted" />
              <div>
                <div className="tiny subtle">Scheduled</div>
                <div className="strong small">{formatDateTime(r.scheduledStart)}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {openQuote && (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Banner tone="info">
            You have a quote waiting for your decision.
          </Banner>
        </div>
      )}

      {r.quotes.length > 0 && (
        <section className="section">
          <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Quotes</h3>
          <div className="stack">
            {r.quotes.map((quote) => (
              <button
                key={quote.id}
                type="button"
                className="card-button"
                onClick={() => navigate(`/quotes/${quote.id}`)}
              >
                <div className="row row--between" style={{ marginBottom: 'var(--s2)' }}>
                  <span className="strong tabular small">{quote.number}</span>
                  <StatusPill status={quote.status} />
                </div>
                <div className="row row--between">
                  <div>
                    <div className="tiny subtle">Total</div>
                    <div className="strong tabular" style={{ fontSize: '1.2rem' }}>
                      {formatMoney(quote.totalCents, quote.currency)}
                    </div>
                  </div>
                  {quote.validUntil && (
                    <div style={{ textAlign: 'right' }}>
                      <div className="tiny subtle">Valid until</div>
                      <div className="small strong">{formatDate(quote.validUntil)}</div>
                    </div>
                  )}
                </div>
                {quote.status === 'sent' && (
                  <div style={{ marginTop: 'var(--s3)' }}>
                    <Pill tone="accent">Tap to review and respond</Pill>
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {r.invoices.length > 0 && (
        <section className="section">
          <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Invoices</h3>
          <div className="stack">
            {r.invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                className="card-button"
                onClick={() => navigate(`/invoices/${invoice.id}`)}
              >
                <div className="row row--between" style={{ marginBottom: 'var(--s2)' }}>
                  <span className="strong tabular small">{invoice.number}</span>
                  <StatusPill status={invoice.status} />
                </div>
                <div className="row row--between">
                  <div className="strong tabular" style={{ fontSize: '1.15rem' }}>
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </div>
                  {invoice.dueDate && (
                    <span className="tiny subtle">Due {formatDate(invoice.dueDate)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {r.comments.length > 0 && (
        <section className="section">
          <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Messages</h3>
          <div className="stack">
            {r.comments.map((comment) => (
              <div key={comment.id} className="card card--pad">
                <div className="row" style={{ marginBottom: 'var(--s2)' }}>
                  <Avatar name={comment.authorName} size="sm" />
                  <div className="grow">
                    <div className="strong small">{comment.authorName}</div>
                    <div className="tiny subtle">{formatRelative(comment.createdAt)}</div>
                  </div>
                </div>
                <p className="small" style={{ lineHeight: 1.55 }}>{comment.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {r.canReview && (
        <div style={{ marginTop: 'var(--s5)' }}>
          <Button block size="lg" icon="star" onClick={() => setReviewOpen(true)}>
            Rate this job
          </Button>
        </div>
      )}

      {r.myReview && (
        <div className="card card--pad" style={{ marginTop: 'var(--s5)' }}>
          <div className="tiny subtle" style={{ marginBottom: 'var(--s2)' }}>YOUR REVIEW</div>
          <div className="row" style={{ gap: 4, marginBottom: 'var(--s2)' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Icon
                key={i}
                name={i <= r.myReview!.rating ? 'star-filled' : 'star'}
                size={18}
                className={i <= r.myReview!.rating ? 'star-on' : 'subtle'}
              />
            ))}
          </div>
          {r.myReview.comment && <p className="small muted">{r.myReview.comment}</p>}
        </div>
      )}

      <ReviewModal
        open={reviewOpen}
        requestId={r.id}
        onClose={() => setReviewOpen(false)}
        onDone={() => {
          setReviewOpen(false);
          notify('Thanks — your review is published.', 'success');
          request.reload();
        }}
      />
    </Shell>
  );
}

/* -------------------------------------------------------------- review --- */

function ReviewModal({
  open, requestId, onClose, onDone,
}: { open: boolean; requestId: string; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating === 0) {
      setError('Choose a star rating first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/customer/requests/${requestId}/review`,
        { rating, comment: comment.trim() || undefined },
        newIdempotencyKey(),
      );
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your review.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="How did it go?" onClose={onClose}>
      <p className="modal__body">
        Your rating helps other customers choose with confidence.
      </p>

      {error && <div style={{ marginBottom: 'var(--s4)' }}><Banner tone="danger">{error}</Banner></div>}

      <div
        className="row"
        style={{ gap: 'var(--s2)', justifyContent: 'center', marginBottom: 'var(--s5)' }}
        role="radiogroup"
        aria-label="Star rating"
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? '' : 's'}`}
            onClick={() => setRating(value)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: 4,
              color: value <= rating ? 'var(--terracotta-500)' : 'var(--text-subtle)',
            }}
          >
            <Icon name={value <= rating ? 'star-filled' : 'star'} size={36} />
          </button>
        ))}
      </div>

      <TextArea
        label="Add a comment (optional)"
        placeholder="Arrived on time, explained the problem clearly and left the place tidy."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={1500}
      />

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy}>Publish review</Button>
      </div>
    </Modal>
  );
}
