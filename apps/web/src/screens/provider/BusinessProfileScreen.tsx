import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon, categoryIcon } from '../../components/Icon';
import {
  Button, TextField, TextArea, SelectField, Banner, Pill, StatusPill,
  SkeletonList, ErrorState, EmptyState, Modal, ConfirmDialog,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { useAuth } from '../../state/auth';
import { formatMoney } from '../../lib/format';

interface BusinessProfile {
  id: string;
  slug: string;
  businessName: string;
  tagline: string | null;
  bio: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  serviceRadiusKm: number;
  yearsExperience: number | null;
  verificationStatus: string;
  verificationNote: string | null;
  isPublished: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
}

export function BusinessProfileScreen() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { refreshUser } = useAuth();

  const profile = useApi(() => api.get<BusinessProfile>('/provider/profile'), []);

  const [form, setForm] = useState({
    businessName: '', tagline: '', bio: '', phone: '', whatsappPhone: '',
    addressLine: '', city: '', region: '', serviceRadiusKm: '25', yearsExperience: '',
  });
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate the form once the profile arrives.
  useEffect(() => {
    if (!profile.data) return;
    const p = profile.data;
    setForm({
      businessName: p.businessName ?? '',
      tagline: p.tagline ?? '',
      bio: p.bio ?? '',
      phone: p.phone ?? '',
      whatsappPhone: p.whatsappPhone ?? '',
      addressLine: p.addressLine ?? '',
      city: p.city ?? '',
      region: p.region ?? '',
      serviceRadiusKm: String(p.serviceRadiusKm ?? 25),
      yearsExperience: p.yearsExperience !== null ? String(p.yearsExperience) : '',
    });
    setPublished(p.isPublished);
  }, [profile.data]);

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/provider/profile', {
        businessName: form.businessName,
        tagline: form.tagline || null,
        bio: form.bio || null,
        phone: form.phone || null,
        whatsappPhone: form.whatsappPhone || null,
        addressLine: form.addressLine || null,
        city: form.city || null,
        region: form.region || null,
        serviceRadiusKm: Number(form.serviceRadiusKm) || 25,
        yearsExperience: form.yearsExperience ? Number(form.yearsExperience) : null,
        isPublished: published,
      });
      notify('Business profile saved.', 'success');
      profile.reload();
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  if (profile.loading) {
    return <Shell title="Business profile" tabs={PROVIDER_TABS} back><SkeletonList rows={4} /></Shell>;
  }
  if (profile.error || !profile.data) {
    return (
      <Shell title="Business profile" tabs={PROVIDER_TABS} back>
        <ErrorState message={profile.error ?? 'Not found.'} onRetry={profile.reload} />
      </Shell>
    );
  }

  return (
    <Shell title="Business profile" tabs={PROVIDER_TABS} back="/profile">
      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="card card--pad mb-5">
        <div className="row row--between mb-3">
          <div>
            <div className="tiny subtle">VERIFICATION</div>
            <StatusPill status={profile.data.verificationStatus} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tiny subtle">PUBLIC PROFILE</div>
            <Pill tone={published ? 'success' : 'neutral'}>{published ? 'Listed' : 'Hidden'}</Pill>
          </div>
        </div>

        {profile.data.verificationNote && (
          <p className="small muted">{profile.data.verificationNote}</p>
        )}

        <label className="checkbox-row mt-2">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
          />
          <span className="small">
            List my business publicly so customers can find me in search.
          </span>
        </label>

        <div className="row" style={{ gap: 'var(--s4)', marginTop: 'var(--s3)' }}>
          <div>
            <div className="tiny subtle">Rating</div>
            <div className="strong">{profile.data.ratingAvg || '—'} ({profile.data.ratingCount})</div>
          </div>
          <div>
            <div className="tiny subtle">Jobs completed</div>
            <div className="strong">{profile.data.completedJobs}</div>
          </div>
        </div>
      </div>

      <TextField label="Business name" value={form.businessName} onChange={update('businessName')} required />
      <TextField
        label="Tagline"
        placeholder="Licensed & insured — same-day emergency service"
        hint="One line customers see under your name."
        value={form.tagline}
        onChange={update('tagline')}
        maxLength={160}
      />
      <TextArea
        label="About your business"
        placeholder="Family-run plumbing shop serving Santo Domingo since 2013…"
        value={form.bio}
        onChange={update('bio')}
        maxLength={2000}
      />

      <TextField label="Phone" type="tel" placeholder="+18095551234" value={form.phone} onChange={update('phone')} />
      <TextField
        label="WhatsApp number"
        type="tel"
        placeholder="+18095551234"
        hint="Shown to customers as a contact option."
        value={form.whatsappPhone}
        onChange={update('whatsappPhone')}
      />

      <TextField label="Address" value={form.addressLine} onChange={update('addressLine')} />
      <TextField label="City" value={form.city} onChange={update('city')} />
      <TextField label="Region" value={form.region} onChange={update('region')} />

      <SelectField
        label="Service radius"
        value={form.serviceRadiusKm}
        onChange={update('serviceRadiusKm')}
        options={[10, 25, 50, 100, 200].map((km) => ({ value: String(km), label: `${km} km` }))}
      />

      <TextField
        label="Years of experience"
        type="number"
        min="0"
        max="80"
        value={form.yearsExperience}
        onChange={update('yearsExperience')}
      />

      <Button block size="lg" loading={busy} onClick={save}>Save profile</Button>

      <div className="mt-3">
        <Button
          variant="secondary"
          block
          icon="search"
          onClick={() => navigate(`/providers/${profile.data!.slug}`)}
        >
          Preview public profile
        </Button>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------ services --- */

interface ServiceRow {
  id: string;
  title: string;
  shortDescription: string | null;
  pricingType: 'fixed' | 'starting_at' | 'request_quote';
  priceCents: number | null;
  currency: string;
  estimatedDurationMin: number | null;
  status: string;
  category: { id: string; name: string; slug: string };
}

interface CategoryOption { id: string; slug: string; name: string }

export function ServicesScreen() {
  const { notify } = useToast();
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ServiceRow | null>(null);
  const [busy, setBusy] = useState(false);

  const services = useApi(() => api.get<{ data: ServiceRow[] }>('/provider/services', { limit: 50 }), []);
  const categories = useApi(() => api.get<{ data: CategoryOption[] }>('/categories'), []);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/provider/services/${deleting.id}`);
      notify('Listing deleted.', 'success');
      setDeleting(null);
      services.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not delete that listing.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (service: ServiceRow) => {
    const next = service.status === 'active' ? 'paused' : 'active';
    try {
      await api.patch(`/provider/services/${service.id}`, { status: next });
      notify(next === 'active' ? 'Listing is live.' : 'Listing paused.', 'success');
      services.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update the listing.', 'error');
    }
  };

  return (
    <Shell
      title="Service listings"
      tabs={PROVIDER_TABS}
      back="/profile"
      action={
        <button
          type="button"
          className="app-header__action"
          onClick={() => setEditing('new')}
          aria-label="Add a listing"
        >
          <Icon name="plus" size={22} />
        </button>
      }
    >
      {services.loading ? (
        <SkeletonList rows={4} />
      ) : services.error ? (
        <ErrorState message={services.error} onRetry={services.reload} />
      ) : !services.data?.data.length ? (
        <EmptyState
          icon="grid"
          title="No listings yet"
          body="Add the services you offer so customers can find you in search."
          action={<Button icon="plus" onClick={() => setEditing('new')}>Add a listing</Button>}
        />
      ) : (
        <div className="stack">
          {services.data.data.map((service) => (
            <div key={service.id} className="card card--pad">
              <div className="row" style={{ alignItems: 'flex-start', marginBottom: 'var(--s3)' }}>
                <div
                  className="avatar"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  <Icon name={categoryIcon(service.category.slug)} size={22} />
                </div>
                <div className="grow">
                  <div className="list-item__title">{service.title}</div>
                  <div className="list-item__meta">{service.category.name}</div>
                </div>
                <StatusPill status={service.status} />
              </div>

              <div className="row row--between mb-3">
                <span className="small muted">
                  {service.pricingType === 'request_quote' ? 'Quote on request'
                    : service.pricingType === 'starting_at' ? 'Starting at'
                    : 'Fixed price'}
                </span>
                <span className="strong tabular">
                  {service.priceCents !== null
                    ? formatMoney(service.priceCents, service.currency)
                    : '—'}
                </span>
              </div>

              <div className="row" style={{ gap: 'var(--s2)' }}>
                <Button size="sm" variant="secondary" onClick={() => setEditing(service)}>
                  <Icon name="edit" size={15} /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggleStatus(service)}>
                  {service.status === 'active' ? 'Pause' : 'Publish'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(service)}>
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ServiceEditor
        target={editing}
        categories={categories.data?.data ?? []}
        onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); services.reload(); }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this listing?"
        body={`"${deleting?.title}" will be removed from search. Jobs already created from it are not affected.`}
        confirmLabel="Delete listing"
        danger
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Shell>
  );
}

function ServiceEditor({
  target, categories, onClose, onDone,
}: {
  target: ServiceRow | 'new' | null;
  categories: CategoryOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useToast();
  const isNew = target === 'new';
  const existing = target && target !== 'new' ? target : null;

  const [form, setForm] = useState({
    categoryId: '', title: '', shortDescription: '', description: '',
    pricingType: 'fixed', price: '', duration: '', status: 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    if (existing) {
      setForm({
        categoryId: existing.category.id,
        title: existing.title,
        shortDescription: existing.shortDescription ?? '',
        description: '',
        pricingType: existing.pricingType,
        price: existing.priceCents !== null ? (existing.priceCents / 100).toFixed(2) : '',
        duration: existing.estimatedDurationMin ? String(existing.estimatedDurationMin) : '',
        status: existing.status,
      });
    } else {
      setForm({
        categoryId: categories[0]?.id ?? '', title: '', shortDescription: '', description: '',
        pricingType: 'fixed', price: '', duration: '', status: 'active',
      });
    }
    setError(null);
  }, [target, existing, categories]);

  const update = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const quoteOnly = form.pricingType === 'request_quote';
      const payload = {
        categoryId: form.categoryId,
        title: form.title,
        shortDescription: form.shortDescription || null,
        description: form.description || null,
        pricingType: form.pricingType,
        priceCents: quoteOnly ? null : Math.round(Number(form.price) * 100),
        estimatedDurationMin: form.duration ? Number(form.duration) : null,
        status: form.status,
      };

      if (existing) await api.patch(`/provider/services/${existing.id}`, payload);
      else await api.post('/provider/services', payload);

      notify(existing ? 'Listing updated.' : 'Listing created.', 'success');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save this listing.');
      setBusy(false);
    }
  };

  if (!target) return null;

  return (
    <Modal open title={isNew ? 'New listing' : 'Edit listing'} onClose={onClose}>
      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <SelectField
        label="Category"
        value={form.categoryId}
        onChange={update('categoryId')}
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />

      <TextField
        label="Title"
        placeholder="Toilet repair and valve replacement"
        value={form.title}
        onChange={update('title')}
        maxLength={120}
      />

      <TextField
        label="Short description"
        placeholder="Same-day toilet repairs"
        value={form.shortDescription}
        onChange={update('shortDescription')}
        maxLength={200}
      />

      <TextArea
        label="Full description"
        placeholder="Diagnosis, valve replacement, seal check and clean-up. Parts for standard models included."
        value={form.description}
        onChange={update('description')}
        maxLength={4000}
      />

      <SelectField
        label="Pricing"
        value={form.pricingType}
        onChange={update('pricingType')}
        options={[
          { value: 'fixed', label: 'Fixed price' },
          { value: 'starting_at', label: 'Starting at' },
          { value: 'request_quote', label: 'Quote on request' },
        ]}
      />

      {form.pricingType !== 'request_quote' && (
        <TextField
          label="Price"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="120.00"
          value={form.price}
          onChange={update('price')}
        />
      )}

      <TextField
        label="Estimated duration (minutes)"
        type="number"
        min="5"
        placeholder="90"
        value={form.duration}
        onChange={update('duration')}
      />

      <SelectField
        label="Status"
        value={form.status}
        onChange={update('status')}
        options={[
          { value: 'active', label: 'Active — visible in search' },
          { value: 'paused', label: 'Paused — hidden' },
          { value: 'draft', label: 'Draft' },
        ]}
      />

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!form.title.trim() || !form.categoryId}>
          {isNew ? 'Create listing' : 'Save changes'}
        </Button>
      </div>
    </Modal>
  );
}
