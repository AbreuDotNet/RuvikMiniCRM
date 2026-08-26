import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS } from '../../components/nav';
import { Icon, categoryIcon } from '../../components/Icon';
import {
  Button, Stars, Pill, SkeletonList, ErrorState, EmptyState, Modal, SelectField,
} from '../../components/ui';
import { useApi, useDebounced } from '../../lib/useApi';
import { api } from '../../lib/api';
import { formatMoney, formatDuration } from '../../lib/format';
import type { Category, ServiceCard, Paginated } from './types';
import { priceLabel } from './types';

export function SearchScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedQuery = useDebounced(query, 350);

  const category = params.get('category') ?? '';
  const minRating = params.get('minRating') ?? '';
  const pricingType = params.get('pricingType') ?? '';
  const sort = params.get('sort') ?? 'relevance';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const categories = useApi(() => api.get<{ data: Category[] }>('/categories'), []);

  const results = useApi(
    () => api.get<Paginated<ServiceCard>>('/search/services', {
      q: debouncedQuery || undefined,
      category: category || undefined,
      minRating: minRating || undefined,
      pricingType: pricingType || undefined,
      sort,
      limit: 20,
    }),
    [debouncedQuery, category, minRating, pricingType, sort],
  );

  const activeFilterCount = [category, minRating, pricingType].filter(Boolean).length;

  return (
    <Shell
      title="Search"
      tabs={CUSTOMER_TABS}
      action={
        <button
          type="button"
          className="app-header__action"
          onClick={() => setFiltersOpen(true)}
          aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
        >
          <Icon name="filter" size={20} />
          {activeFilterCount > 0 && <span className="app-header__badge">{activeFilterCount}</span>}
        </button>
      }
    >
      <div className="search-input-wrap" style={{ marginBottom: 'var(--s3)' }}>
        <Icon name="search" size={19} />
        <input
          className="input"
          type="search"
          placeholder="Plumber, air conditioner repair…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search services"
          autoComplete="off"
        />
      </div>

      <div className="category-row" style={{ marginBottom: 'var(--s2)' }}>
        <button
          type="button"
          className={`category-tile${!category ? ' is-active' : ''}`}
          onClick={() => setParam('category', '')}
        >
          <span className="category-tile__icon"><Icon name="grid" size={24} /></span>
          <span>All</span>
        </button>
        {categories.data?.data.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`category-tile${category === c.slug ? ' is-active' : ''}`}
            onClick={() => setParam('category', category === c.slug ? '' : c.slug)}
            aria-pressed={category === c.slug}
          >
            <span className="category-tile__icon"><Icon name={categoryIcon(c.slug)} size={24} /></span>
            <span>{c.name}</span>
          </button>
        ))}
      </div>

      <div className="row row--between" style={{ marginBottom: 'var(--s3)' }}>
        <span className="tiny subtle" aria-live="polite">
          {results.loading
            ? 'Searching…'
            : `${results.data?.data.length ?? 0} result${results.data?.data.length === 1 ? '' : 's'}`}
        </span>
        <select
          className="select"
          value={sort}
          onChange={(e) => setParam('sort', e.target.value)}
          aria-label="Sort results"
          style={{ width: 'auto', minHeight: 36, padding: '0 36px 0 12px', fontSize: '0.84rem' }}
        >
          <option value="relevance">Most relevant</option>
          <option value="rating">Highest rated</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="newest">Newest</option>
        </select>
      </div>

      {results.loading ? (
        <SkeletonList rows={5} />
      ) : results.error ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : !results.data?.data.length ? (
        <EmptyState
          icon="search"
          title="No services match that search"
          body="Try a different keyword, or clear your filters to see everything available."
          action={
            activeFilterCount > 0 ? (
              <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="stack">
          {results.data.data.map((service) => (
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
                  <div className="list-item__title clamp-2">{service.title}</div>
                  <div className="list-item__meta truncate">
                    {service.provider.businessName}
                    {service.provider.city ? ` · ${service.provider.city}` : ''}
                  </div>
                  <div className="row row--wrap" style={{ gap: 'var(--s2)', marginTop: 6 }}>
                    <Stars rating={service.provider.ratingAvg} count={service.provider.ratingCount} />
                    {service.provider.verificationStatus === 'verified' && (
                      <Pill tone="success"><Icon name="shield" size={12} /> Verified</Pill>
                    )}
                  </div>
                </div>
              </div>

              {/* Price sits on its own row so a long title never squeezes it. */}
              <div className="card-footer-row">
                <span className="tiny subtle">
                  {service.estimatedDurationMin ? formatDuration(service.estimatedDurationMin) : service.category.name}
                </span>
                <span className="price-tag tabular">
                  {service.pricingType === 'starting_at' && <span className="tiny subtle">from </span>}
                  {priceLabel(service.pricingType, service.priceCents, service.currency, formatMoney)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)}>
        <div className="filter-sheet__group">
          <p className="field__label" style={{ marginBottom: 'var(--s2)' }}>Minimum rating</p>
          <div className="rating-row">
            {['', '3', '4', '4.5'].map((value) => (
              <button
                key={value || 'any'}
                type="button"
                className={`chip${minRating === value ? ' is-active' : ''}`}
                onClick={() => setParam('minRating', value)}
                aria-pressed={minRating === value}
              >
                {value ? (
                  <><Icon name="star-filled" size={13} /> {value}+</>
                ) : 'Any rating'}
              </button>
            ))}
          </div>
        </div>

        <SelectField
          label="Pricing type"
          value={pricingType}
          onChange={(e) => setParam('pricingType', e.target.value)}
          options={[
            { value: '', label: 'Any pricing' },
            { value: 'fixed', label: 'Fixed price' },
            { value: 'starting_at', label: 'Starting at' },
            { value: 'request_quote', label: 'Quote on request' },
          ]}
        />

        <div className="modal__actions">
          <Button
            variant="secondary"
            onClick={() => {
              setParams(new URLSearchParams(), { replace: true });
              setQuery('');
            }}
          >
            Clear all
          </Button>
          <Button onClick={() => setFiltersOpen(false)}>Show results</Button>
        </div>
      </Modal>
    </Shell>
  );
}
