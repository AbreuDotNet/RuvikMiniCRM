import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, Avatar, Pill, StatusPill, SkeletonList, ErrorState, EmptyState,
  Modal, TextField, LoadMore, RefreshBar,
} from '../../components/ui';
import { useApi, usePagedApi, useDebounced } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatDate, formatRelative } from '../../lib/format';

interface ClientRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  isPlatformCustomer: boolean;
  jobCount: number;
  lastJobAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 40;

export function ClientsScreen() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const debounced = useDebounced(query, 300);

  const clients = usePagedApi<ClientRow>(
    (cursor) => api.get('/provider/clients', {
      q: debounced || undefined, cursor: cursor ?? undefined, limit: PAGE_SIZE,
    }),
    [debounced],
  );

  return (
    <Shell
      title="Clients"
      tabs={PROVIDER_TABS}
      action={
        <button
          type="button"
          className="app-header__action"
          onClick={() => setAddOpen(true)}
          aria-label="Add a client"
        >
          <Icon name="plus" size={22} />
        </button>
      }
    >
      <div className="search-input-wrap mb-4">
        <Icon name="search" size={19} />
        <input
          className="input"
          type="search"
          placeholder="Search by name, email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </div>

      {clients.loading ? (
        <SkeletonList rows={5} />
      ) : clients.error ? (
        <ErrorState message={clients.error} onRetry={clients.reload} />
      ) : !clients.items.length ? (
        <EmptyState
          icon="users"
          title={query ? 'No clients match that search' : 'No clients yet'}
          body={
            query
              ? 'Try a different name or number.'
              : 'Customers who request a quote are added automatically. You can also add someone you already work with.'
          }
          action={<Button icon="plus" onClick={() => setAddOpen(true)}>Add a client</Button>}
        />
      ) : (
        <div className="results-stack" aria-busy={clients.refreshing}>
          <RefreshBar active={clients.refreshing} />
          <div className="list-group">
          {clients.items.map((client) => (
            <button
              key={client.id}
              type="button"
              className="list-item"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <Avatar name={client.fullName} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <span className="list-item__title truncate">{client.fullName}</span>
                  {client.isPlatformCustomer && (
                    <Icon name="shield" size={13} style={{ color: 'var(--brand)' }} />
                  )}
                </div>
                <div className="list-item__meta truncate">
                  {client.phone ?? client.email ?? client.city ?? 'No contact details'}
                </div>
              </div>
              <div className="list-item__trail">
                <div className="small strong">{client.jobCount}</div>
                <div className="tiny subtle">job{client.jobCount === 1 ? '' : 's'}</div>
              </div>
            </button>
          ))}
          </div>

          <LoadMore
            hasMore={clients.hasMore}
            loading={clients.loadingMore}
            error={clients.moreError}
            onLoadMore={clients.loadMore}
            count={clients.items.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      <AddClientModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={(id) => { setAddOpen(false); navigate(`/clients/${id}`); }}
      />
    </Shell>
  );
}

function AddClientModal({
  open, onClose, onDone,
}: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useToast();

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>('/provider/clients', {
        fullName: form.fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
      });
      notify('Client added.', 'success');
      onDone(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not add that client.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Add a client" onClose={onClose}>
      {error && <p className="field__error mb-3" role="alert">{error}</p>}

      <TextField label="Full name" value={form.fullName} onChange={update('fullName')} required autoFocus />
      <TextField label="Phone" type="tel" placeholder="(809) 555-1234" hint="US numbers can skip the +1." value={form.phone} onChange={update('phone')} />
      <TextField label="Email" type="email" value={form.email} onChange={update('email')} />
      <TextField label="City" value={form.city} onChange={update('city')} />

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!form.fullName.trim()}>Add client</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- client detail --- */

interface ClientDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressLine: string | null;
  city: string | null;
  isPlatformCustomer: boolean;
  createdAt: string;
  jobs: Array<{
    id: string; reference: string; title: string; status: string;
    scheduledStart: string | null; completedAt: string | null; createdAt: string;
  }>;
}

export function ClientDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const client = useApi(() => api.get<ClientDetail>(`/provider/clients/${id}`), [id]);

  if (client.loading) {
    return <Shell title="Client" tabs={PROVIDER_TABS} back><SkeletonList rows={3} /></Shell>;
  }
  if (client.error || !client.data) {
    return (
      <Shell title="Client" tabs={PROVIDER_TABS} back>
        <ErrorState message={client.error ?? 'Client not found.'} onRetry={client.reload} />
      </Shell>
    );
  }

  const c = client.data;

  return (
    <Shell title={c.fullName} tabs={PROVIDER_TABS} back="/clients">
      <div className="card card--pad mb-4">
        <div className="row mb-3">
          <Avatar name={c.fullName} size="lg" />
          <div className="grow">
            <h2>{c.fullName}</h2>
            {c.city && <p className="small muted">{c.city}</p>}
            {c.isPlatformCustomer && (
              <div style={{ marginTop: 6 }}>
                <Pill tone="brand"><Icon name="shield" size={12} /> Ruvik customer</Pill>
              </div>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--s2)' }}>
          {c.phone && (
            <a className="btn btn--secondary btn--sm grow" href={`tel:${c.phone}`}>
              <Icon name="phone" size={16} /> Call
            </a>
          )}
          {c.whatsappPhone && (
            <a
              className="btn btn--whatsapp btn--sm grow"
              href={`https://wa.me/${c.whatsappPhone.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="whatsapp" size={16} /> WhatsApp
            </a>
          )}
          {c.email && (
            <a className="btn btn--secondary btn--sm grow" href={`mailto:${c.email}`}>
              <Icon name="mail" size={16} /> Email
            </a>
          )}
        </div>

        <hr className="divider" />

        <div className="stack stack--tight">
          {c.email && <DetailRow label="Email" value={c.email} />}
          {c.phone && <DetailRow label="Phone" value={c.phone} />}
          {c.addressLine && <DetailRow label="Address" value={c.addressLine} />}
          <DetailRow label="Client since" value={formatDate(c.createdAt)} />
        </div>
      </div>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">Jobs ({c.jobs.length})</h3>
          <button type="button" className="section__link" onClick={() => navigate('/jobs/new')}>
            + New job
          </button>
        </div>

        {c.jobs.length === 0 ? (
          <EmptyState icon="briefcase" title="No jobs yet" body="Create a job to start quoting for this client." />
        ) : (
          <div className="list-group">
            {c.jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className="list-item"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <div className="grow">
                  <div className="list-item__title truncate">{job.title}</div>
                  <div className="list-item__meta tabular">
                    {job.reference} · {formatRelative(job.createdAt)}
                  </div>
                </div>
                <StatusPill status={job.status} />
              </button>
            ))}
          </div>
        )}
      </section>
    </Shell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row row--between">
      <span className="small muted">{label}</span>
      <span className="small strong">{value}</span>
    </div>
  );
}
