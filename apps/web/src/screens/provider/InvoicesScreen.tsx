import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, StatusPill, Pill, SkeletonList, ErrorState, EmptyState, Banner, PickerField, TextField,
  LoadMore, RefreshBar,
} from '../../components/ui';
import { useApi, usePagedApi, type PagedResponse } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatMoney, formatDate } from '../../lib/format';

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  clientName: string;
  job: { id: string; title: string } | null;
}

/** The list endpoint also carries the outstanding/paid totals. */
interface InvoiceList extends PagedResponse<InvoiceRow> {
  summary: { outstandingCents: number; paidCents: number };
}

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

const PAGE_SIZE = 30;

export function InvoicesScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';

  const invoices = usePagedApi<InvoiceRow, InvoiceList>(
    (cursor) => api.get('/invoices', {
      status: status || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [status],
  );

  return (
    <Shell
      title="Invoices"
      tabs={PROVIDER_TABS}
      action={
        <button
          type="button"
          className="app-header__action"
          onClick={() => navigate('/invoices/new')}
          aria-label="Create an invoice"
        >
          <Icon name="plus" size={22} />
        </button>
      }
    >
      {invoices.response && (
        <div className="stat-grid mb-4">
          <div className="stat-tile stat-tile--accent" style={{ cursor: 'default' }}>
            <span className="stat-tile__value tabular">
              {formatMoney(invoices.response.summary.outstandingCents)}
            </span>
            <span className="stat-tile__label">Outstanding</span>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <span className="stat-tile__value tabular" style={{ color: 'var(--success)' }}>
              {formatMoney(invoices.response.summary.paidCents)}
            </span>
            <span className="stat-tile__label">Collected</span>
          </div>
        </div>
      )}

      <div className="chip-row mb-4">
        {FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            className={`chip${status === filter.value ? ' is-active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (filter.value) next.set('status', filter.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
            aria-pressed={status === filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {invoices.loading ? (
        <SkeletonList rows={5} />
      ) : invoices.error ? (
        <ErrorState message={invoices.error} onRetry={invoices.reload} />
      ) : !invoices.items.length ? (
        <EmptyState
          icon="receipt"
          title={status ? 'Nothing here' : 'No invoices yet'}
          body={
            status
              ? 'Try another filter.'
              : 'Once a customer accepts a quote you can turn it into an invoice in one tap.'
          }
          action={<Button icon="plus" onClick={() => navigate('/invoices/new')}>New invoice</Button>}
        />
      ) : (
        <div className="stack results-stack" aria-busy={invoices.refreshing}>
          <RefreshBar active={invoices.refreshing} />
          {invoices.items.map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              className="card-button"
              onClick={() => navigate(`/invoices/${invoice.id}`)}
            >
              <div className="row row--between mb-2">
                <span className="tiny subtle tabular">{invoice.number}</span>
                <StatusPill status={invoice.status} />
              </div>

              <div className="row row--between">
                <div className="grow">
                  <div className="list-item__title truncate">{invoice.clientName}</div>
                  {invoice.job && <div className="list-item__meta truncate">{invoice.job.title}</div>}
                </div>
                <div className="list-item__trail">
                  <div className="strong tabular" style={{ fontSize: '1.05rem' }}>
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </div>
                  {invoice.balanceCents > 0 && invoice.status !== 'draft' && (
                    <div className="tiny subtle tabular">
                      {formatMoney(invoice.balanceCents, invoice.currency)} due
                    </div>
                  )}
                </div>
              </div>

              {invoice.dueDate && invoice.status !== 'paid' && (
                <div className="tiny subtle mt-2">
                  Due {formatDate(invoice.dueDate)}
                </div>
              )}
            </button>
          ))}

          <LoadMore
            hasMore={invoices.hasMore}
            loading={invoices.loadingMore}
            error={invoices.moreError}
            onLoadMore={invoices.loadMore}
            count={invoices.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}
    </Shell>
  );
}

/* ----------------------------------------------------- invoice builder --- */

interface QuoteOption {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  currency: string;
  clientName: string;
  job: { id: string; title: string };
  /** The invoice already raised from this quote, if there is one. */
  invoice: { id: string; number: string; status: string } | null;
}

export function InvoiceBuilderScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();

  const [quoteId, setQuoteId] = useState(params.get('quote') ?? '');
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('Thank you for your business.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only accepted quotes can become invoices, so that is all we offer.
  const quotes = useApi(
    () => api.get<{ data: QuoteOption[] }>('/quotes', { status: 'accepted', limit: 50 }),
    [],
  );

  const submit = async (send: boolean) => {
    if (!quoteId) {
      setError('Choose an accepted quote to invoice.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; number: string }>(
        '/invoices',
        { fromQuoteId: quoteId, dueDate: dueDate || undefined, notes: notes.trim() || undefined },
        newIdempotencyKey(),
      );
      if (send) {
        await api.post(`/invoices/${created.id}/send`, {}, newIdempotencyKey());
        notify(`${created.number} sent.`, 'success');
      } else {
        notify(`${created.number} saved as a draft.`, 'success');
      }
      navigate(`/invoices/${created.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not create this invoice.');
      setBusy(false);
    }
  };

  return (
    <Shell title="New invoice" tabs={PROVIDER_TABS} back>
      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {quotes.loading ? (
        <SkeletonList rows={2} />
      ) : !quotes.data?.data.length ? (
        <EmptyState
          icon="file-text"
          title="No accepted quotes"
          body="An invoice is created from a quote your customer has accepted. Send a quote first."
          action={<Button onClick={() => navigate('/jobs')}>Go to jobs</Button>}
        />
      ) : (
        <>
          <Banner tone="info">
            The invoice copies the accepted quote exactly — same lines, same totals — so the
            customer is billed what they agreed to.
          </Banner>

          <div style={{ height: 'var(--s5)' }} />

          <PickerField
            label="Accepted quote"
            value={quoteId}
            placeholder="Choose a quote…"
            searchPlaceholder="Search by number, client or job…"
            emptyText="No accepted quotes to invoice."
            onChange={setQuoteId}
            options={quotes.data.data.map((quote) => ({
              value: quote.id,
              label: quote.number,
              description: quote.job.title,
              meta: quote.invoice
                // Say which invoice, not just that one exists: the provider is
                // usually looking for it rather than trying to raise another.
                ? `${quote.clientName} · already invoiced as ${quote.invoice.number}`
                : `${quote.clientName} · ${formatMoney(quote.totalCents, quote.currency)}`,
              badge: quote.invoice
                ? <Pill tone="neutral">Invoiced</Pill>
                : <Pill tone="success">Ready</Pill>,
              disabled: Boolean(quote.invoice),
              keywords: quote.clientName,
            }))}
          />

          <TextField
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />

          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />

          <div className="stack mt-5">
            <Button block size="lg" icon="check" loading={busy} onClick={() => submit(true)}>
              Create and send
            </Button>
            <Button block variant="secondary" disabled={busy} onClick={() => submit(false)}>
              Save as draft
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}
