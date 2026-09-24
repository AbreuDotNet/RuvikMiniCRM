import { Router } from 'express';
import { z } from 'zod';
import { booleanish } from '../../lib/zodBoolean.js';
import * as svc from './service.js';
import { asyncHandler } from '../../middleware/errorHandler.js';
import { authenticate, requireProvider, tenantId } from '../../middleware/auth.js';
import { limiters } from '../../middleware/rateLimit.js';
import { idempotency } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';

export const billingRouter = Router();

/** Plans are public: the pricing page is shown before signup. */
billingRouter.get(
  '/plans',
  limiters.search,
  asyncHandler(async (_req, res) => {
    res.json({ data: await svc.listPlans() });
  }),
);

billingRouter.get(
  '/subscription',
  authenticate,
  requireProvider,
  asyncHandler(async (req, res) => {
    res.json({ subscription: await svc.getSubscription(tenantId(req)) });
  }),
);

billingRouter.post(
  '/subscription',
  authenticate,
  requireProvider,
  limiters.financial,
  idempotency('billing.subscribe'),
  validate(z.object({ planCode: z.string().min(2).max(40) })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await svc.startSubscription(
      tenantId(req),
      req.auth!.userId,
      req.body.planCode,
      // Threaded through to Stripe so its own idempotency matches this
      // request's, rather than each call minting an unrelated key.
      typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined,
    ));
  }),
);

/**
 * A link into Stripe's Customer Portal, where the provider changes plan,
 * updates their card or cancels.
 *
 * POST rather than GET: it creates a short-lived session at Stripe, and a GET
 * that mutates something at a third party is the kind of thing a link
 * prefetcher fires by accident.
 */
billingRouter.post(
  '/portal',
  authenticate,
  requireProvider,
  limiters.financial,
  asyncHandler(async (req, res) => {
    res.json(await svc.createBillingPortalSession(
      tenantId(req),
      typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined,
    ));
  }),
);

billingRouter.delete(
  '/subscription',
  authenticate,
  requireProvider,
  limiters.financial,
  validate(z.object({ immediate: booleanish.default(false) }), 'query'),
  asyncHandler(async (req, res) => {
    const immediate = String(req.query.immediate) === 'true';
    res.json(await svc.cancelSubscription(tenantId(req), req.auth!.userId, immediate));
  }),
);
