import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon, categoryIcon } from '../../components/Icon';
import {
  Button, Stars, Pill, Avatar, SkeletonList, ErrorState, EmptyState,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatMoney, formatDate, formatDuration } from '../../lib/format';
import type { PublicProvider } from './types';
import { priceLabel } from './types';

const DAY_LABELS: Array<[string, string]> = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

export function ProviderProfileScreen() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'services' | 'about' | 'reviews'>('services');

  const provider = useApi(
    () => api.get<PublicProvider>(`/providers/${slug}`),
    [slug],
  );

  if (provider.loading) {
    return (
      <Shell title="Provider" tabs={CUSTOMER_TABS} back>
        <SkeletonList rows={4} />
      </Shell>
    );
  }

  if (provider.error || !provider.data) {
    return (
      <Shell title="Provider" tabs={CUSTOMER_TABS} back>
        <ErrorState message={provider.error ?? 'Provider not found.'} onRetry={provider.reload} />
      </Shell>
    );
  }

  const p = provider.data;

  return (
    <Shell title={p.businessName} tabs={CUSTOMER_TABS} back flush>
      <div style={{ padding: '0 var(--s4)' }}>
        <div className="provider-cover" />
      </div>

      <div className="provider-head">
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 'var(--s3)' }}>
          {p.logoUrl ? (
            <img
              src={p.logoUrl}
              alt=""
              width={72}
              height={72}
              style={{
                borderRadius: 'var(--radius-pill)', objectFit: 'cover',
                border: '3px solid var(--bg-elevated)',
              }}
            />
          ) : (
            <div style={{ border: '3px solid var(--bg-elevated)', borderRadius: 999 }}>
              <Avatar name={p.businessName} size="lg" />
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 'var(--s2)', marginBottom: 4 }}>
          <h2>{p.businessName}</h2>
          {p.verificationStatus === 'verified' && (
            <Pill tone="success"><Icon name="shield" size={12} /> Verified</Pill>
          )}
        </div>

        {p.tagline && <p className="muted small mb-2">{p.tagline}</p>}

        <div className="row row--wrap" style={{ gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <Stars rating={p.ratingAvg} count={p.ratingCount} />
          {p.city && (
            <span className="small muted row" style={{ gap: 4 }}>
              <Icon name="map-pin" size={14} /> {p.city}
            </span>
          )}
          <span className="small muted row" style={{ gap: 4 }}>
            <Icon name="check" size={14} /> {p.completedJobs} jobs done
          </span>
        </div>

        <div className="row" style={{ gap: 'var(--s2)' }}>
          <Button
            block
            icon="file-text"
            onClick={() => navigate(`/request?provider=${p.id}`)}
          >
            Request quote
          </Button>
        </div>
      </div>

      <div style={{ padding: '0 var(--s4) var(--s4)' }}>
        <div className="tab-strip" role="tablist" aria-label="Provider details">
          {([
            ['services', `Services (${p.services.length})`],
            ['about', 'About'],
            ['reviews', `Reviews (${p.ratingCount})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`tab-strip__tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'services' && (
          p.services.length === 0 ? (
            <EmptyState icon="briefcase" title="No listings yet" body="This provider has not published any services." />
          ) : (
            <div className="stack">
              {p.services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className="card-button"
                  onClick={() => navigate(`/services/${service.id}`)}
                >
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <div
                      className="avatar"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                      aria-hidden="true"
                    >
                      <Icon name={categoryIcon(service.category.slug)} size={22} />
                    </div>
                    <div className="grow">
                      <div className="list-item__title">{service.title}</div>
                      {service.shortDescription && (
                        <div className="list-item__meta">{service.shortDescription}</div>
                      )}
                      {service.estimatedDurationMin && (
                        <div className="tiny subtle" style={{ marginTop: 4 }}>
                          <Icon name="clock" size={12} /> {formatDuration(service.estimatedDurationMin)}
                        </div>
                      )}
                    </div>
                    <div className="list-item__trail strong tabular">
                      {service.pricingType === 'starting_at' && (
                        <span className="tiny subtle" style={{ fontWeight: 400 }}>from </span>
                      )}
                      {priceLabel(service.pricingType, service.priceCents, service.currency, formatMoney)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        )}

        {tab === 'about' && (
          <div className="stack stack--loose">
            {p.bio && (
              <section>
                <h3 className="mb-2">About</h3>
                <p className="muted" style={{ lineHeight: 1.6 }}>{p.bio}</p>
              </section>
            )}

            {p.portfolio.length > 0 && (
              <section>
                <h3 className="mb-3">Recent work</h3>
                <div className="photo-grid">
                  {p.portfolio.map((photo) => (
                    <div key={photo.id} className="photo-grid__item">
                      <img src={photo.url} alt={photo.caption ?? 'Portfolio photo'} loading="lazy" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-3">Working hours</h3>
              <div className="list-group">
                {DAY_LABELS.map(([key, label]) => {
                  const hours = p.workingHours?.[key];
                  const closed = !hours || hours.closed;
                  return (
                    <div key={key} className="list-item" style={{ cursor: 'default', minHeight: 46 }}>
                      <span className="grow small">{label}</span>
                      <span className={closed ? 'small subtle' : 'small strong tabular'}>
                        {closed ? 'Closed' : `${hours.open} – ${hours.close}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {p.certifications.length > 0 && (
              <section>
                <h3 className="mb-3">Credentials</h3>
                <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
                  {p.certifications.map((cert) => (
                    <Pill key={cert} tone="brand"><Icon name="shield" size={12} /> {cert}</Pill>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-3">Details</h3>
              <div className="list-group">
                <div className="list-item" style={{ cursor: 'default', minHeight: 46 }}>
                  <span className="grow small muted">Service radius</span>
                  <span className="small strong">{p.serviceRadiusKm} km</span>
                </div>
                {p.yearsExperience !== null && (
                  <div className="list-item" style={{ cursor: 'default', minHeight: 46 }}>
                    <span className="grow small muted">Experience</span>
                    <span className="small strong">{p.yearsExperience} years</span>
                  </div>
                )}
                <div className="list-item" style={{ cursor: 'default', minHeight: 46 }}>
                  <span className="grow small muted">On Ruvik since</span>
                  <span className="small strong">{formatDate(p.memberSince)}</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'reviews' && (
          p.reviews.length === 0 ? (
            <EmptyState
              icon="star"
              title="No reviews yet"
              body="Reviews appear here once customers complete a job with this provider."
            />
          ) : (
            <div className="stack">
              {p.reviews.map((review) => (
                <article key={review.id} className="card card--pad">
                  <div className="row mb-2">
                    <Avatar name={review.customerName} size="sm" />
                    <div className="grow">
                      <div className="strong small">{review.customerName}</div>
                      <div className="tiny subtle">{formatDate(review.createdAt)}</div>
                    </div>
                    <Stars rating={review.rating} size={13} />
                  </div>
                  {review.comment && <p className="small" style={{ lineHeight: 1.6 }}>{review.comment}</p>}
                  {review.providerReply && (
                    <div
                      style={{
                        marginTop: 'var(--s3)', padding: 'var(--s3)',
                        background: 'var(--bg-inset)', borderRadius: 'var(--radius)',
                      }}
                    >
                      <div className="tiny strong subtle" style={{ marginBottom: 4 }}>
                        Reply from {p.businessName}
                      </div>
                      <p className="small">{review.providerReply}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )
        )}
      </div>
    </Shell>
  );
}
