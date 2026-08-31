import { useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon, categoryIcon } from '../../components/Icon';
import { Button, Stars, Pill, SkeletonList, ErrorState } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatMoney, formatDuration } from '../../lib/format';
import { priceLabel } from './types';

interface ServiceDetail {
  id: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  pricingType: 'fixed' | 'starting_at' | 'request_quote';
  priceCents: number | null;
  currency: string;
  estimatedDurationMin: number | null;
  coverageArea: string | null;
  category: { slug: string; name: string };
  provider: {
    id: string; slug: string; businessName: string; tagline: string | null;
    city: string | null; ratingAvg: number; ratingCount: number;
    verificationStatus: string; completedJobs: number;
  };
}

export function ServiceDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const service = useApi(() => api.get<ServiceDetail>(`/services/${id}`), [id]);

  if (service.loading) {
    return <Shell title="Service" tabs={CUSTOMER_TABS} back><SkeletonList rows={3} /></Shell>;
  }
  if (service.error || !service.data) {
    return (
      <Shell title="Service" tabs={CUSTOMER_TABS} back>
        <ErrorState message={service.error ?? 'Service not found.'} onRetry={service.reload} />
      </Shell>
    );
  }

  const s = service.data;

  return (
    <Shell title="Service" tabs={CUSTOMER_TABS} back>
      <div className="card card--pad" style={{ marginBottom: 'var(--s4)' }}>
        <div className="row" style={{ marginBottom: 'var(--s3)' }}>
          <div className="avatar avatar--lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Icon name={categoryIcon(s.category.slug)} size={32} />
          </div>
          <div className="grow">
            <Pill tone="brand">{s.category.name}</Pill>
            <h2 style={{ marginTop: 'var(--s2)' }}>{s.title}</h2>
          </div>
        </div>

        {s.shortDescription && <p className="muted">{s.shortDescription}</p>}

        <hr className="divider" />

        <div className="row row--between">
          <div>
            <div className="tiny subtle">
              {s.pricingType === 'fixed' ? 'Fixed price'
                : s.pricingType === 'starting_at' ? 'Starting at' : 'Pricing'}
            </div>
            <div className="strong tabular" style={{ fontSize: '1.4rem', color: 'var(--accent)' }}>
              {priceLabel(s.pricingType, s.priceCents, s.currency, formatMoney)}
            </div>
          </div>
          {s.estimatedDurationMin && (
            <div style={{ textAlign: 'right' }}>
              <div className="tiny subtle">Estimated time</div>
              <div className="strong">{formatDuration(s.estimatedDurationMin)}</div>
            </div>
          )}
        </div>
      </div>

      {s.description && (
        <section className="section">
          <h3 style={{ marginBottom: 'var(--s2)' }}>What is included</h3>
          <p className="muted" style={{ lineHeight: 1.65 }}>{s.description}</p>
        </section>
      )}

      {s.coverageArea && (
        <section className="section">
          <h3 style={{ marginBottom: 'var(--s2)' }}>Coverage area</h3>
          <p className="muted row" style={{ gap: 6 }}>
            <Icon name="map-pin" size={16} /> {s.coverageArea}
          </p>
        </section>
      )}

      <section className="section">
        <h3 style={{ marginBottom: 'var(--s3)' }}>Offered by</h3>
        <button
          type="button"
          className="card-button"
          onClick={() => navigate(`/providers/${s.provider.slug}`)}
        >
          <div className="row">
            <div className="avatar" style={{ background: 'var(--brand)' }} aria-hidden="true">
              <Icon name="briefcase" size={20} />
            </div>
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="list-item__title truncate">{s.provider.businessName}</span>
                {s.provider.verificationStatus === 'verified' && (
                  <Icon name="shield" size={15} style={{ color: 'var(--success)' }} />
                )}
              </div>
              {s.provider.city && <div className="list-item__meta">{s.provider.city}</div>}
              <div style={{ marginTop: 4 }}>
                <Stars rating={s.provider.ratingAvg} count={s.provider.ratingCount} />
              </div>
            </div>
            <Icon name="chevron" size={18} className="subtle" />
          </div>
        </button>
      </section>

      <div className="sticky-action">
        <Button
          block
          size="lg"
          icon="file-text"
          onClick={() => navigate(`/request?provider=${s.provider.id}&service=${s.id}`)}
        >
          Request a quote
        </Button>
      </div>
    </Shell>
  );
}
