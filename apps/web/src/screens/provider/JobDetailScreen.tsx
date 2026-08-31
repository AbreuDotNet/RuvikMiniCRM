import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, StatusPill, Avatar, SkeletonList, ErrorState, Modal, TextArea, Banner, Pill,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import {
  formatMoney, formatDateTime, formatRelative, statusLabel,
} from '../../lib/format';

interface JobDetail {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  allowedNextStatuses: string[];
  source: string;
  addressLine: string | null;
  city: string | null;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string;
  serviceTitle: string | null;
  client: {
    id: string; fullName: string; email: string | null;
    phone: string | null; whatsappPhone: string | null;
  };
  notes: Array<{
    id: string; body: string; visibility: 'internal' | 'customer';
    authorName: string; createdAt: string;
  }>;
  quotes: Array<{
    id: string; number: string; status: string; totalCents: number;
    currency: string; validUntil: string | null;
  }>;
  invoices: Array<{
    id: string; number: string; status: string; totalCents: number;
    amountPaidCents: number; currency: string;
  }>;
  timeline: Array<{ fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }>;
}

export function JobDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [noteOpen, setNoteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const job = useApi(() => api.get<JobDetail>(`/provider/jobs/${id}`), [id]);

  if (job.loading) {
    return <Shell title="Job" tabs={PROVIDER_TABS} back><SkeletonList rows={3} /></Shell>;
  }
  if (job.error || !job.data) {
    return (
      <Shell title="Job" tabs={PROVIDER_TABS} back>
        <ErrorState message={job.error ?? 'Job not found.'} onRetry={job.reload} />
      </Shell>
    );
  }

  const j = job.data;
  const acceptedQuote = j.quotes.find((q) => q.status === 'accepted');
  const canInvoice = acceptedQuote && j.invoices.length === 0;

  return (
    <Shell title={j.reference} tabs={PROVIDER_TABS} back="/jobs">
      <div className="card card--pad mb-4">
        <div className="row row--between mb-3">
          <StatusPill status={j.status} />
          <span className="tiny subtle">{formatRelative(j.createdAt)}</span>
        </div>

        <h2 className="mb-2">{j.title}</h2>
        {j.description && <p className="muted small" style={{ lineHeight: 1.6 }}>{j.description}</p>}

        {j.allowedNextStatuses.length > 0 && (
          <>
            <hr className="divider" />
            <Button block variant="secondary" icon="check" onClick={() => setStatusOpen(true)}>
              Move to next stage
            </Button>
          </>
        )}
      </div>

      <section className="section">
        <h3 className="section__title mb-3">Client</h3>
        <div className="card card--pad">
          <button
            type="button"
            className="row"
            style={{ width: '100%', border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
            onClick={() => navigate(`/clients/${j.client.id}`)}
          >
            <Avatar name={j.client.fullName} />
            <div className="grow">
              <div className="strong">{j.client.fullName}</div>
              {j.city && <div className="tiny subtle">{j.city}</div>}
            </div>
            <Icon name="chevron" size={18} className="subtle" />
          </button>

          {(j.client.phone || j.client.email) && (
            <>
              <hr className="divider" />
              <div className="row" style={{ gap: 'var(--s2)' }}>
                {j.client.phone && (
                  <a className="btn btn--secondary btn--sm grow" href={`tel:${j.client.phone}`}>
                    <Icon name="phone" size={16} /> Call
                  </a>
                )}
                {j.client.whatsappPhone && (
                  <a
                    className="btn btn--whatsapp btn--sm grow"
                    href={`https://wa.me/${j.client.whatsappPhone.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="whatsapp" size={16} /> WhatsApp
                  </a>
                )}
                {j.client.email && (
                  <a className="btn btn--secondary btn--sm grow" href={`mailto:${j.client.email}`}>
                    <Icon name="mail" size={16} /> Email
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {j.addressLine && (
        <section className="section">
          <h3 className="section__title mb-3">Location</h3>
          <div className="card card--pad row" style={{ gap: 'var(--s2)' }}>
            <Icon name="map-pin" size={18} className="muted" />
            <span className="small">{j.addressLine}{j.city ? `, ${j.city}` : ''}</span>
          </div>
        </section>
      )}

      {j.scheduledStart && (
        <section className="section">
          <h3 className="section__title mb-3">Scheduled</h3>
          <div className="card card--pad row" style={{ gap: 'var(--s2)' }}>
            <Icon name="calendar" size={18} className="muted" />
            <span className="small strong">{formatDateTime(j.scheduledStart)}</span>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">Quotes</h3>
          <button type="button" className="section__link" onClick={() => navigate(`/quotes/new?job=${j.id}`)}>
            + New quote
          </button>
        </div>
        {j.quotes.length === 0 ? (
          <div className="card card--pad center">
            <p className="small muted mb-3">
              No quote yet. Sending one usually takes under two minutes.
            </p>
            <Button icon="file-text" onClick={() => navigate(`/quotes/new?job=${j.id}`)}>
              Create quote
            </Button>
          </div>
        ) : (
          <div className="list-group">
            {j.quotes.map((quote) => (
              <button
                key={quote.id}
                type="button"
                className="list-item"
                onClick={() => navigate(`/quotes/${quote.id}`)}
              >
                <div className="grow">
                  <div className="list-item__title tabular">{quote.number}</div>
                  <div className="list-item__meta tabular">
                    {formatMoney(quote.totalCents, quote.currency)}
                  </div>
                </div>
                <StatusPill status={quote.status} />
              </button>
            ))}
          </div>
        )}
      </section>

      {canInvoice && (
        <div className="mb-5">
          <Banner tone="success" icon="check">
            This quote was accepted — you can turn it into an invoice in one tap.
          </Banner>
          <div className="mt-3">
            <Button
              block
              icon="receipt"
              onClick={() => navigate(`/invoices/new?quote=${acceptedQuote!.id}`)}
            >
              Create invoice from quote
            </Button>
          </div>
        </div>
      )}

      {j.invoices.length > 0 && (
        <section className="section">
          <h3 className="section__title mb-3">Invoices</h3>
          <div className="list-group">
            {j.invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                className="list-item"
                onClick={() => navigate(`/invoices/${invoice.id}`)}
              >
                <div className="grow">
                  <div className="list-item__title tabular">{invoice.number}</div>
                  <div className="list-item__meta tabular">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </div>
                </div>
                <StatusPill status={invoice.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">Notes</h3>
          <button type="button" className="section__link" onClick={() => setNoteOpen(true)}>
            + Add note
          </button>
        </div>
        {j.notes.length === 0 ? (
          <p className="small subtle">No notes yet.</p>
        ) : (
          <div className="stack">
            {j.notes.map((note) => (
              <div key={note.id} className="card card--pad">
                <div className="row row--between mb-2">
                  <span className="tiny strong subtle">{note.authorName}</span>
                  <Pill tone={note.visibility === 'internal' ? 'neutral' : 'brand'}>
                    {note.visibility === 'internal' ? 'Internal only' : 'Shared with customer'}
                  </Pill>
                </div>
                <p className="small" style={{ lineHeight: 1.55 }}>{note.body}</p>
                <div className="tiny subtle mt-2">
                  {formatRelative(note.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h3 className="section__title mb-3">History</h3>
        <div className="card card--pad">
          <div className="timeline">
            {j.timeline.map((event, index) => (
              <div className="timeline__item" key={index}>
                <div className={`timeline__dot${index === 0 ? ' timeline__dot--done' : ''}`} />
                <div className="grow">
                  <div className="timeline__label">{statusLabel(event.toStatus)}</div>
                  {event.note && <div className="tiny muted">{event.note}</div>}
                  <div className="timeline__time">{formatRelative(event.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <StatusModal
        open={statusOpen}
        jobId={j.id}
        options={j.allowedNextStatuses}
        onClose={() => setStatusOpen(false)}
        onDone={() => { setStatusOpen(false); notify('Job updated.', 'success'); job.reload(); }}
      />

      <NoteModal
        open={noteOpen}
        jobId={j.id}
        onClose={() => setNoteOpen(false)}
        onDone={() => { setNoteOpen(false); notify('Note added.', 'success'); job.reload(); }}
      />
    </Shell>
  );
}

function StatusModal({
  open, jobId, options, onClose, onDone,
}: { open: boolean; jobId: string; options: string[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const { notify } = useToast();

  const move = async (status: string) => {
    setBusy(status);
    try {
      const body: Record<string, unknown> = { status };
      // Scheduling without a date would leave the calendar empty.
      if (status === 'scheduled') body.scheduledStart = new Date(Date.now() + 86_400_000).toISOString();
      await api.post(`/provider/jobs/${jobId}/status`, body);
      onDone();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update the job.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} title="Move this job" onClose={onClose}>
      <p className="modal__body">Choose the next stage in the pipeline.</p>
      <div className="stack">
        {options.map((status) => (
          <Button
            key={status}
            variant={status === 'cancelled' ? 'danger' : 'secondary'}
            block
            loading={busy === status}
            onClick={() => move(status)}
          >
            {statusLabel(status)}
          </Button>
        ))}
      </div>
      <div className="mt-4">
        <Button variant="ghost" block onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function NoteModal({
  open, jobId, onClose, onDone,
}: { open: boolean; jobId: string; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/provider/jobs/${jobId}/notes`, { body: body.trim(), visibility });
      setBody('');
      onDone();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not save the note.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Add a note" onClose={onClose}>
      <TextArea
        label="Note"
        placeholder="Spoke with the customer — access available weekday mornings."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        autoFocus
      />

      <div className="segmented mb-4">
        <button
          type="button"
          className={`segmented__option${visibility === 'internal' ? ' is-active' : ''}`}
          onClick={() => setVisibility('internal')}
        >
          Internal only
        </button>
        <button
          type="button"
          className={`segmented__option${visibility === 'customer' ? ' is-active' : ''}`}
          onClick={() => setVisibility('customer')}
        >
          Share with customer
        </button>
      </div>

      <p className="tiny subtle mb-4">
        {visibility === 'internal'
          ? 'Only you can see internal notes. The customer never sees them.'
          : 'The customer will see this note and get a notification.'}
      </p>

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!body.trim()}>Save note</Button>
      </div>
    </Modal>
  );
}
