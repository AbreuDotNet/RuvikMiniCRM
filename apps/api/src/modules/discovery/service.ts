import { getDb } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import {
  buildKeysetPage, decodeKeyset, keysetOrderBy, keysetWhere,
  type Page, type SortColumn,
} from '../../lib/pagination.js';
import { signStorageUrl } from '../../lib/storage.js';

export interface SearchFilters {
  q?: string;
  category?: string;
  city?: string;
  pricingType?: 'fixed' | 'starting_at' | 'request_quote';
  minRating?: number;
  maxPriceCents?: number;
  verifiedOnly?: boolean;
  sort?: 'relevance' | 'rating' | 'price_asc' | 'price_desc' | 'newest';
  limit: number;
  cursor?: string;
}

export interface ServiceSearchRow {
  id: string;
  created_at: string;
  /** ts_rank of the row, present only when the caller passed a text query. */
  rank?: string | null;
  title: string;
  short_description: string | null;
  pricing_type: string;
  price_cents: number | null;
  currency: string;
  estimated_duration_min: number | null;
  category_slug: string;
  category_name: string;
  provider_id: string;
  provider_slug: string;
  business_name: string;
  city: string | null;
  rating_avg: string;
  rating_count: number;
  verification_status: string;
  photos: unknown;
}

/**
 * Service search across the public catalogue.
 *
 * Only published, verified-or-unverified-but-active providers appear, and
 * only `active` listings. Ranking uses the stored tsvector when a text query
 * is present; otherwise the caller's chosen sort.
 *
 * The query is a single statement with joins — deliberately not a per-row
 * provider lookup — so result count does not multiply round trips (no N+1).
 */
export async function searchServices(filters: SearchFilters): Promise<Page<ServiceSearchRow>> {
  const db = await getDb();
  const params: unknown[] = [];
  const where: string[] = [
    "s.status = 'active'",
    'p.is_published = true',
    "u.status = 'active'",
  ];

  const push = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  let rankParam: string | null = null;
  if (filters.q) {
    const p = push(filters.q);
    rankParam = p;
    where.push(`(s.search_doc @@ plainto_tsquery('simple', ${p})
                 OR p.search_doc @@ plainto_tsquery('simple', ${p})
                 OR c.name ILIKE '%' || ${p} || '%')`);
  }
  if (filters.category) where.push(`c.slug = ${push(filters.category)}`);
  if (filters.city) where.push(`lower(p.city) = lower(${push(filters.city)})`);
  if (filters.pricingType) where.push(`s.pricing_type = ${push(filters.pricingType)}`);
  if (typeof filters.minRating === 'number') where.push(`p.rating_avg >= ${push(filters.minRating)}`);
  if (typeof filters.maxPriceCents === 'number') {
    // request_quote listings have no price and must not be filtered out by a
    // price ceiling the customer set for comparable fixed-price work.
    where.push(`(s.price_cents IS NULL OR s.price_cents <= ${push(filters.maxPriceCents)})`);
  }
  if (filters.verifiedOnly) where.push(`p.verification_status = 'verified'`);

  // Every sort ends with (created_at, id) so the ordering is total and the
  // keyset below can never straddle two rows that compare equal.
  const TIEBREAK: SortColumn[] = [
    { sql: 's.created_at', direction: 'DESC', nulls: 'LAST', type: 'timestamptz' },
    { sql: 's.id', direction: 'DESC', nulls: 'LAST', type: 'uuid' },
  ];

  // ts_rank is selected as well as ordered by, so the cursor can carry the
  // exact value the row was ranked with rather than recomputing it.
  //
  // The ::float8 is load-bearing. ts_rank returns float4, and Postgres prints
  // a float4 as the shortest text that round-trips *as a float4* — read back
  // into a JS double that text is a near-but-unequal number, so the cursor's
  // equality test missed every row it tied with and pages dropped rows.
  // Widening to float8 first makes the printed value round-trip exactly.
  const rankSql = rankParam
    ? `ts_rank(s.search_doc, plainto_tsquery('simple', ${rankParam}))::float8`
    : null;

  let sortColumns: SortColumn[];
  if (filters.sort === 'rating') {
    sortColumns = [
      { sql: 'p.rating_avg', direction: 'DESC', nulls: 'LAST', type: 'numeric' },
      { sql: 'p.rating_count', direction: 'DESC', nulls: 'LAST', type: 'int' },
      ...TIEBREAK,
    ];
  } else if (filters.sort === 'price_asc' || filters.sort === 'price_desc') {
    sortColumns = [
      {
        sql: 's.price_cents',
        direction: filters.sort === 'price_asc' ? 'ASC' : 'DESC',
        nulls: 'LAST',
        type: 'int',
      },
      ...TIEBREAK,
    ];
  } else if (filters.sort === 'relevance' && rankSql) {
    sortColumns = [
      { sql: rankSql, direction: 'DESC', nulls: 'LAST', type: 'float8' },
      { sql: 'p.rating_avg', direction: 'DESC', nulls: 'LAST', type: 'numeric' },
      ...TIEBREAK,
    ];
  } else {
    sortColumns = TIEBREAK;
  }

  if (filters.cursor) {
    where.push(keysetWhere(sortColumns, decodeKeyset(filters.cursor, sortColumns), push));
  }

  const limitParam = push(filters.limit + 1);

  const sql = `
    SELECT s.id, s.created_at, s.title, s.short_description, s.pricing_type, s.price_cents,
           s.currency, s.estimated_duration_min, s.photos,
           c.slug AS category_slug, c.name AS category_name,
           p.id AS provider_id, p.slug AS provider_slug, p.business_name, p.city,
           p.rating_avg, p.rating_count, p.verification_status
           ${rankSql ? `, ${rankSql} AS rank` : ''}
      FROM services s
      JOIN providers p  ON p.id = s.provider_id
      JOIN users u      ON u.id = p.user_id
      JOIN categories c ON c.id = s.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${keysetOrderBy(sortColumns)}
     LIMIT ${limitParam}`;

  const { rows } = await db.query<ServiceSearchRow>(sql, params);

  // Reads the same tuple the ORDER BY used, in the same order.
  const asText = (value: unknown): string | null =>
    value === null || value === undefined
      ? null
      : value instanceof Date
        ? value.toISOString()
        : String(value);

  return buildKeysetPage(rows, filters.limit, (row) =>
    sortColumns.map((col) => {
      if (col.sql === 's.created_at') return asText(row.created_at);
      if (col.sql === 's.id') return asText(row.id);
      if (col.sql === 'p.rating_avg') return asText(row.rating_avg);
      if (col.sql === 'p.rating_count') return asText(row.rating_count);
      if (col.sql === 's.price_cents') return asText(row.price_cents);
      return asText(row.rank);
    }),
  );
}

/** Public provider profile: business details, active services, recent reviews. */
export async function getPublicProvider(slugOrId: string) {
  const db = await getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

  const { rows } = await db.query<any>(
    `SELECT p.id, p.slug, p.business_name, p.tagline, p.bio, p.city, p.region, p.country,
            p.service_radius_km, p.working_hours, p.certifications, p.years_experience,
            p.verification_status, p.rating_avg, p.rating_count, p.completed_jobs,
            p.phone_e164, p.created_at,
            f.storage_key AS logo_key
       FROM providers p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN files f ON f.id = p.logo_file_id AND f.scan_status = 'clean'
      WHERE ${isUuid ? 'p.id = $1' : 'p.slug = $1'}
        AND p.is_published = true AND u.status = 'active'`,
    [slugOrId],
  );
  const provider = rows[0];
  if (!provider) throw notFound('We could not find that provider.');

  // Three scoped queries rather than one row-multiplying join.
  const [services, reviews, portfolio] = await Promise.all([
    db.query<any>(
      `SELECT s.id, s.title, s.short_description, s.pricing_type, s.price_cents, s.currency,
              s.estimated_duration_min, s.photos, c.slug AS category_slug, c.name AS category_name
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.provider_id = $1 AND s.status = 'active'
        ORDER BY s.created_at DESC LIMIT 50`,
      [provider.id],
    ),
    db.query<any>(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.provider_reply, r.replied_at,
              u.full_name AS customer_name
         FROM reviews r JOIN users u ON u.id = r.customer_user_id
        WHERE r.provider_id = $1 AND r.status = 'published'
        ORDER BY r.created_at DESC LIMIT 20`,
      [provider.id],
    ),
    db.query<any>(
      `SELECT pi.id, pi.caption, f.storage_key
         FROM provider_portfolio_images pi
         JOIN files f ON f.id = pi.file_id
        WHERE pi.provider_id = $1 AND f.scan_status = 'clean'
        ORDER BY pi.sort_order LIMIT 24`,
      [provider.id],
    ),
  ]);

  return {
    id: provider.id,
    slug: provider.slug,
    businessName: provider.business_name,
    tagline: provider.tagline,
    bio: provider.bio,
    city: provider.city,
    region: provider.region,
    country: provider.country,
    serviceRadiusKm: provider.service_radius_km,
    workingHours: provider.working_hours,
    certifications: provider.certifications,
    yearsExperience: provider.years_experience,
    verificationStatus: provider.verification_status,
    ratingAvg: Number(provider.rating_avg),
    ratingCount: provider.rating_count,
    completedJobs: provider.completed_jobs,
    memberSince: provider.created_at,
    logoUrl: provider.logo_key ? signStorageUrl(provider.logo_key, 3600) : null,
    services: services.rows.map((s) => ({
      id: s.id,
      title: s.title,
      shortDescription: s.short_description,
      pricingType: s.pricing_type,
      priceCents: s.price_cents,
      currency: s.currency,
      estimatedDurationMin: s.estimated_duration_min,
      category: { slug: s.category_slug, name: s.category_name },
      photos: s.photos,
    })),
    reviews: reviews.rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at,
      providerReply: r.provider_reply,
      repliedAt: r.replied_at,
      // Only the display name is exposed, never the reviewer's contact details.
      customerName: r.customer_name,
    })),
    portfolio: portfolio.rows.map((p) => ({
      id: p.id,
      caption: p.caption,
      url: signStorageUrl(p.storage_key, 3600),
    })),
  };
}

export async function getPublicService(serviceId: string) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT s.id, s.title, s.short_description, s.description, s.pricing_type, s.price_cents,
            s.currency, s.estimated_duration_min, s.coverage_area, s.photos, s.created_at,
            c.slug AS category_slug, c.name AS category_name,
            p.id AS provider_id, p.slug AS provider_slug, p.business_name, p.tagline,
            p.city, p.rating_avg, p.rating_count, p.verification_status, p.completed_jobs
       FROM services s
       JOIN providers p ON p.id = s.provider_id
       JOIN users u ON u.id = p.user_id
       JOIN categories c ON c.id = s.category_id
      WHERE s.id = $1 AND s.status = 'active' AND p.is_published = true AND u.status = 'active'`,
    [serviceId],
  );
  const s = rows[0];
  if (!s) throw notFound('That service is no longer available.');

  return {
    id: s.id,
    title: s.title,
    shortDescription: s.short_description,
    description: s.description,
    pricingType: s.pricing_type,
    priceCents: s.price_cents,
    currency: s.currency,
    estimatedDurationMin: s.estimated_duration_min,
    coverageArea: s.coverage_area,
    photos: s.photos,
    category: { slug: s.category_slug, name: s.category_name },
    provider: {
      id: s.provider_id,
      slug: s.provider_slug,
      businessName: s.business_name,
      tagline: s.tagline,
      city: s.city,
      ratingAvg: Number(s.rating_avg),
      ratingCount: s.rating_count,
      verificationStatus: s.verification_status,
      completedJobs: s.completed_jobs,
    },
  };
}

export async function listCategories() {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT c.id, c.slug, c.name, c.icon, c.description,
            count(s.id) FILTER (WHERE s.status = 'active') AS service_count
       FROM categories c
       LEFT JOIN services s ON s.category_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id
      ORDER BY c.sort_order, c.name`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    icon: r.icon,
    description: r.description,
    serviceCount: Number(r.service_count),
  }));
}

/** Featured providers for the customer home screen. */
export async function listFeaturedProviders(limit = 10) {
  const db = await getDb();
  const { rows } = await db.query<any>(
    `SELECT p.id, p.slug, p.business_name, p.tagline, p.city, p.rating_avg, p.rating_count,
            p.verification_status, p.completed_jobs,
            (SELECT c.name FROM services s JOIN categories c ON c.id = s.category_id
              WHERE s.provider_id = p.id AND s.status = 'active'
              ORDER BY s.created_at LIMIT 1) AS primary_category
       FROM providers p
       JOIN users u ON u.id = p.user_id
      WHERE p.is_published = true AND u.status = 'active'
        AND EXISTS (SELECT 1 FROM services s WHERE s.provider_id = p.id AND s.status = 'active')
      ORDER BY p.rating_avg DESC, p.rating_count DESC, p.completed_jobs DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    businessName: r.business_name,
    tagline: r.tagline,
    city: r.city,
    ratingAvg: Number(r.rating_avg),
    ratingCount: r.rating_count,
    verificationStatus: r.verification_status,
    completedJobs: r.completed_jobs,
    primaryCategory: r.primary_category,
  }));
}
