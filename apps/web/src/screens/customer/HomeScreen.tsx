import { useNavigate } from 'react-router-dom';
import { Shell, BellAction } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon, categoryIcon } from '../../components/Icon';
import { Section, Stars, Pill, SkeletonList, ErrorState, EmptyState, Button } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { statusLabel, statusTone } from '../../lib/format';
import type { Category, FeaturedProvider } from './types';

interface HomePayload {
  recentRequests: Array<{
    id: string; reference: string; title: string; status: string;
    createdAt: string; providerName: string; providerSlug: string;
  }>;
  unreadNotifications: number;
}

export function CustomerHomeScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const categories = useApi(() => api.get<{ data: Category[] }>('/categories'), []);
  const featured = useApi(() => api.get<{ data: FeaturedProvider[] }>('/providers/featured', { limit: 6 }), []);
  const home = useApi(() => api.get<HomePayload>('/customer/home'), []);

  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <Shell
      title="Customer Home"
      tabs={CUSTOMER_TABS}
      action={<BellAction unread={home.data?.unreadNotifications ?? 0} />}
    >
      <div className="hero">
        <p className="hero__greeting">Hello, {firstName}</p>
        <p className="hero__title">What needs fixing today?</p>
        <button
          type="button"
          className="search-input-wrap"
          onClick={() => navigate('/search')}
          style={{ display: 'block', width: '100%', border: 'none', background: 'none', padding: 0, textAlign: 'left' }}
          aria-label="Search for services"
        >
          <Icon name="search" size={19} />
          <div className="input" style={{ display: 'flex', alignItems: 'center', color: 'var(--text-subtle)' }}>
            Search for services…
          </div>
        </button>
      </div>

      <Section title="Featured categories">
        {categories.loading ? (
          <div className="category-row">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="category-tile">
                <div className="skeleton" style={{ width: 56, height: 56, borderRadius: 999 }} />
                <div className="skeleton" style={{ width: 44, height: 10 }} />
              </div>
            ))}
          </div>
        ) : categories.error ? (
          <ErrorState message={categories.error} onRetry={categories.reload} />
        ) : (
          <div className="category-row">
            {categories.data?.data.map((category) => (
              <button
                key={category.id}
                type="button"
                className="category-tile"
                onClick={() => navigate(`/search?category=${category.slug}`)}
              >
                <span className="category-tile__icon">
                  <Icon name={categoryIcon(category.slug)} size={26} />
                </span>
                <span>{category.name}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Top rated nearby"
        action={
          <button type="button" className="section__link" onClick={() => navigate('/search')}>
            See all
          </button>
        }
      >
        {featured.loading ? (
          <SkeletonList rows={3} />
        ) : featured.error ? (
          <ErrorState message={featured.error} onRetry={featured.reload} />
        ) : !featured.data?.data.length ? (
          <EmptyState
            icon="search"
            title="No providers yet"
            body="As professionals join Ruvik in your area, they will appear here."
          />
        ) : (
          <div className="stack">
            {featured.data.data.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className="card-button"
                onClick={() => navigate(`/providers/${provider.slug}`)}
              >
                <div className="row">
                  <div
                    className="avatar"
                    style={{ background: 'var(--brand)' }}
                    aria-hidden="true"
                  >
                    <Icon name={categoryIcon(provider.primaryCategory?.toLowerCase() ?? '')} size={22} />
                  </div>
                  <div className="grow">
                    <div className="row" style={{ gap: 6 }}>
                      <span className="list-item__title truncate">{provider.businessName}</span>
                      {provider.verificationStatus === 'verified' && (
                        <Icon name="shield" size={15} className="verified-mark" />
                      )}
                    </div>
                    <div className="list-item__meta truncate">
                      {provider.primaryCategory ?? 'Services'}
                      {provider.city ? ` · ${provider.city}` : ''}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Stars rating={provider.ratingAvg} count={provider.ratingCount} />
                    </div>
                  </div>
                  <Icon name="chevron" size={18} className="subtle" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Your recent requests"
        action={
          <button type="button" className="section__link" onClick={() => navigate('/requests')}>
            View all
          </button>
        }
      >
        {home.loading ? (
          <SkeletonList rows={2} />
        ) : !home.data?.recentRequests.length ? (
          <EmptyState
            icon="clipboard"
            title="No requests yet"
            body="Find a professional and ask for a quote — it only takes a minute."
            action={<Button onClick={() => navigate('/search')} icon="search">Browse services</Button>}
          />
        ) : (
          <div className="list-group">
            {home.data.recentRequests.map((request) => (
              <button
                key={request.id}
                type="button"
                className="list-item"
                onClick={() => navigate(`/requests/${request.id}`)}
              >
                <div className="grow">
                  <div className="list-item__title truncate">{request.title}</div>
                  <div className="list-item__meta truncate">{request.providerName}</div>
                </div>
                <div className="list-item__trail">
                  <Pill tone={statusTone(request.status)}>{statusLabel(request.status)}</Pill>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </Shell>
  );
}
