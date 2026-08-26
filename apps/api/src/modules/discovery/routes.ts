import { Router } from 'express';
import { z } from 'zod';
import { booleanish } from '../../lib/zodBoolean.js';
import * as svc from './service.js';
import { validate, validated, uuidSchema } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { limiters } from '../../middleware/rateLimit.js';
import { paginationSchema } from '../../lib/pagination.js';
import { getCache } from '../../lib/cache.js';

export const discoveryRouter = Router();

const searchSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
  pricingType: z.enum(['fixed', 'starting_at', 'request_quote']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxPriceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  verifiedOnly: booleanish.optional(),
  sort: z.enum(['relevance', 'rating', 'price_asc', 'price_desc', 'newest']).default('relevance'),
});

discoveryRouter.get(
  '/search/services',
  limiters.search,
  validate(searchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters = validated<z.infer<typeof searchSchema>>(req);
    const page = await svc.searchServices(filters);
    res.json({
      data: page.data.map(shapeSearchRow),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, limit: filters.limit },
    });
  }),
);

/**
 * Categories change rarely and are requested on every home-screen load, so
 * they are cached. The TTL is short enough that an admin edit shows up
 * without an explicit purge.
 */
discoveryRouter.get(
  '/categories',
  limiters.search,
  asyncHandler(async (_req, res) => {
    const cache = await getCache();
    const cached = await cache.get('categories:v1');
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }
    const payload = { data: await svc.listCategories() };
    await cache.set('categories:v1', JSON.stringify(payload), 120);
    res.setHeader('X-Cache', 'MISS');
    res.json(payload);
  }),
);

discoveryRouter.get(
  '/providers/featured',
  limiters.search,
  validate(z.object({ limit: z.coerce.number().int().min(1).max(24).default(10) }), 'query'),
  asyncHandler(async (req, res) => {
    const { limit } = validated<{ limit: number }>(req);
    res.json({ data: await svc.listFeaturedProviders(limit) });
  }),
);

discoveryRouter.get(
  '/providers/:slug',
  limiters.search,
  validate(z.object({ slug: z.string().trim().min(1).max(80) }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getPublicProvider(req.params.slug));
  }),
);

discoveryRouter.get(
  '/services/:id',
  limiters.search,
  validate(z.object({ id: uuidSchema }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(await svc.getPublicService(req.params.id));
  }),
);

function shapeSearchRow(r: svc.ServiceSearchRow) {
  return {
    id: r.id,
    title: r.title,
    shortDescription: r.short_description,
    pricingType: r.pricing_type,
    priceCents: r.price_cents,
    currency: r.currency,
    estimatedDurationMin: r.estimated_duration_min,
    photos: r.photos,
    category: { slug: r.category_slug, name: r.category_name },
    provider: {
      id: r.provider_id,
      slug: r.provider_slug,
      businessName: r.business_name,
      city: r.city,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
      verificationStatus: r.verification_status,
    },
  };
}
