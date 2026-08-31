import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';
import { runMigrations } from './migrate.js';
import { hashPassword } from '../lib/crypto.js';
import { computeTotals } from '../lib/money.js';
import { nextNumber } from '../lib/numbering.js';
import { slugify } from '../lib/slug.js';
import { logger } from '../lib/logger.js';

/**
 * Demo dataset for local development, E2E tests and screenshots.
 * Every account shares the same password so the demo chips in the login
 * screen work without a credential list.
 */
export const DEMO_PASSWORD = 'RuvikDemo2026!';

const CATEGORIES = [
  { slug: 'plumbing',   name: 'Plumbing',    icon: 'plumbing',   sort: 10, description: 'Leaks, installations, water heaters and drains.' },
  { slug: 'electrical', name: 'Electrical',  icon: 'electrical', sort: 20, description: 'Wiring, panels, lighting and safety inspections.' },
  { slug: 'carpentry',  name: 'Carpentry',   icon: 'carpentry',  sort: 30, description: 'Custom furniture, doors, cabinets and repairs.' },
  { slug: 'hvac',       name: 'HVAC / Air',  icon: 'hvac',       sort: 40, description: 'Air conditioning, ventilation and heating.' },
  { slug: 'painting',   name: 'Painting',    icon: 'painting',   sort: 50, description: 'Interior and exterior painting and finishes.' },
  { slug: 'cleaning',   name: 'Cleaning',    icon: 'cleaning',   sort: 60, description: 'Deep cleaning for homes and offices.' },
  { slug: 'repairs',    name: 'Repairs',     icon: 'repairs',    sort: 70, description: 'General handyman work and small fixes.' },
  { slug: 'appliances', name: 'Appliances',  icon: 'appliances', sort: 80, description: 'Washer, fridge and oven repair.' },
];

const PLANS = [
  {
    code: 'starter', name: 'Starter', price: 0, interval: 'month', maxServices: 3, maxQuotes: 15, sort: 10,
    description: 'Get listed and win your first jobs.',
    features: ['Public profile', '3 service listings', '15 quotes per month', 'In-app notifications'],
  },
  {
    code: 'pro', name: 'Pro', price: 2900, interval: 'month', maxServices: 25, maxQuotes: null, sort: 20,
    description: 'For busy independent professionals.',
    features: ['Everything in Starter', '25 listings', 'Unlimited quotes', 'Branded PDF quotes & invoices',
               'WhatsApp delivery', 'Client CRM & calendar'],
  },
  {
    code: 'business', name: 'Business', price: 7900, interval: 'month', maxServices: null, maxQuotes: null, sort: 30,
    description: 'For small teams and growing shops.',
    features: ['Everything in Pro', 'Unlimited listings', 'Priority placement in search',
               'Verified badge review', 'Priority support'],
  },
];

interface ProviderSeed {
  email: string;
  fullName: string;
  businessName: string;
  tagline: string;
  bio: string;
  city: string;
  phone: string;
  category: string;
  years: number;
  verified: boolean;
  plan: string;
  services: Array<{
    title: string; short: string; description: string;
    pricing: 'fixed' | 'starting_at' | 'request_quote';
    price?: number; duration?: number;
  }>;
}

const PROVIDERS: ProviderSeed[] = [
  {
    email: 'greenleaf@ruvik.demo', fullName: 'Miguel Santana', businessName: 'Greenleaf Plumbing',
    tagline: 'Licensed & insured — same-day emergency service',
    bio: 'Family-run plumbing shop serving Santo Domingo since 2013. We handle everything from a dripping tap to a full repipe, and we always quote before we start.',
    city: 'Santo Domingo', phone: '+18095550111', category: 'plumbing', years: 12, verified: true, plan: 'pro',
    services: [
      { title: 'Toilet repair & valve replacement', short: 'Running or leaking toilet fixed same day', description: 'Diagnosis, flush valve or fill valve replacement, seal check and clean-up. Parts for standard models included.', pricing: 'fixed', price: 12000, duration: 90 },
      { title: 'Water heater installation', short: 'Supply and fit electric or gas units', description: 'Removal of the old unit, fitting, pressure testing and commissioning. Price varies with unit size and pipework.', pricing: 'starting_at', price: 30000, duration: 240 },
      { title: 'Leak detection & repipe', short: 'Find hidden leaks without tearing up the house', description: 'Acoustic and pressure testing to locate leaks, followed by a written quote for the repair work.', pricing: 'request_quote', duration: 120 },
    ],
  },
  {
    email: 'sparktech@ruvik.demo', fullName: 'Carla Peña', businessName: 'Spark Tech Electric',
    tagline: 'Certified electricians — panels, wiring and safety checks',
    bio: 'We specialise in residential rewiring and panel upgrades. Every job ends with a written safety certificate.',
    city: 'Santiago', phone: '+18095550222', category: 'electrical', years: 9, verified: true, plan: 'pro',
    services: [
      { title: 'Electrical panel upgrade', short: 'Modern breaker panel, safely installed', description: 'Load assessment, panel replacement, labelling and certification. Includes permit paperwork.', pricing: 'starting_at', price: 45000, duration: 360 },
      { title: 'Outlet & switch installation', short: 'Add or replace points around the house', description: 'Per-point pricing for new outlets, switches and dimmers on existing circuits.', pricing: 'fixed', price: 3500, duration: 45 },
      { title: 'Full home safety inspection', short: '30-point check with written report', description: 'We test every circuit, check earthing and thermal-scan the panel, then hand you a report.', pricing: 'fixed', price: 8500, duration: 120 },
    ],
  },
  {
    email: 'nordic@ruvik.demo', fullName: 'Elena Rosario', businessName: 'Nordic Wood Carpentry',
    tagline: 'Custom furniture and fitted joinery',
    bio: 'Small workshop making built-in wardrobes, kitchen cabinetry and hardwood doors to measure. We survey first, then quote.',
    city: 'Santo Domingo', phone: '+18095550333', category: 'carpentry', years: 15, verified: true, plan: 'business',
    services: [
      { title: 'Fitted wardrobe (made to measure)', short: 'Designed, built and installed', description: 'Survey, 3D drawing, build in our workshop and installation. Priced per linear metre of finished unit.', pricing: 'request_quote', duration: 2400 },
      { title: 'Interior door hanging', short: 'Supply and hang, per door', description: 'Includes frame adjustment, hinges, handle fitting and finishing.', pricing: 'fixed', price: 7500, duration: 120 },
      { title: 'Kitchen cabinet refacing', short: 'New doors and fronts on your existing carcasses', description: 'A fraction of the cost of a new kitchen. Choice of laminate or solid wood fronts.', pricing: 'starting_at', price: 55000, duration: 960 },
    ],
  },
  {
    email: 'coolbreeze@ruvik.demo', fullName: 'Rafael Núñez', businessName: 'Cool Breeze HVAC',
    tagline: 'Air conditioning specialists — install, service, repair',
    bio: 'Split systems, ducted units and commercial rooftops. Maintenance plans available for offices and rentals.',
    city: 'Punta Cana', phone: '+18095550444', category: 'hvac', years: 7, verified: false, plan: 'starter',
    services: [
      { title: 'Split AC service & deep clean', short: 'Restore cooling and cut running costs', description: 'Coil clean, filter replacement, gas pressure check and drainage clear-out.', pricing: 'fixed', price: 6500, duration: 90 },
      { title: 'Split AC installation', short: 'Supply and install, 12,000–24,000 BTU', description: 'Wall bracket, piping up to 3m, vacuum and commissioning. Unit supplied or bring your own.', pricing: 'starting_at', price: 28000, duration: 300 },
      { title: 'Commercial cooling survey', short: 'Cooling plan for shops and offices', description: 'Heat-load calculation and a written proposal with equipment options.', pricing: 'request_quote', duration: 180 },
    ],
  },
  {
    email: 'brightcoat@ruvik.demo', fullName: 'Luis Fermín', businessName: 'Bright Coat Painting',
    tagline: 'Clean lines, tidy crews, on schedule',
    bio: 'Interior and exterior painting for homes and small commercial spaces. We protect, prep properly and clean up.',
    city: 'Santo Domingo', phone: '+18095550555', category: 'painting', years: 6, verified: false, plan: 'starter',
    services: [
      { title: 'Interior room repaint', short: 'Walls and ceiling, two coats', description: 'Filling, sanding, masking and two coats of premium emulsion. Priced per standard room.', pricing: 'starting_at', price: 14000, duration: 480 },
      { title: 'Exterior facade painting', short: 'Weatherproof finish for the whole house', description: 'Pressure wash, crack repair, primer and two coats of exterior-grade paint.', pricing: 'request_quote', duration: 2880 },
    ],
  },
];

const CUSTOMERS = [
  { email: 'ana@ruvik.demo',    fullName: 'Ana Reyes',        city: 'Santo Domingo', phone: '+18095551001' },
  { email: 'pedro@ruvik.demo',  fullName: 'Pedro Martínez',   city: 'Santiago',      phone: '+18095551002' },
  { email: 'lucia@ruvik.demo',  fullName: 'Lucía Guzmán',     city: 'Santo Domingo', phone: '+18095551003' },
  { email: 'diego@ruvik.demo',  fullName: 'Diego Fernández',  city: 'Punta Cana',    phone: '+18095551004' },
];

export async function seed(): Promise<void> {
  await runMigrations();
  const db = await getDb();

  const already = await db.query<{ count: string }>(
    "SELECT count(*)::text FROM users WHERE email LIKE '%@ruvik.demo'",
  );
  if (Number(already.rows[0].count) > 0) {
    logger.info('demo data already present — skipping seed');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  /* ----------------------------- catalogue ------------------------------ */
  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO categories (slug, name, icon, description, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [c.slug, c.name, c.icon, c.description, c.sort],
    );
    categoryIds.set(c.slug, rows[0].id);
  }

  const planIds = new Map<string, string>();
  for (const p of PLANS) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO subscription_plans (code, name, description, price_cents, currency, interval,
                                       max_services, max_quotes_per_month, features, sort_order)
       VALUES ($1,$2,$3,$4,'USD',$5,$6,$7,$8,$9)
       ON CONFLICT (code) DO UPDATE SET price_cents = EXCLUDED.price_cents
       RETURNING id`,
      [p.code, p.name, p.description, p.price, p.interval, p.maxServices, p.maxQuotes,
       JSON.stringify(p.features), p.sort],
    );
    planIds.set(p.code, rows[0].id);
  }

  /* ------------------------------- admin -------------------------------- */
  await db.query(
    `INSERT INTO users (email, password_hash, role, full_name, status, email_verified_at)
     VALUES ($1,$2,'admin','Platform Admin','active', now())`,
    ['admin@ruvik.demo', passwordHash],
  );

  /* ----------------------------- customers ------------------------------ */
  const customerIds = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, full_name, phone_e164, status,
                          email_verified_at, whatsapp_opt_in, whatsapp_phone_e164, whatsapp_opt_in_at)
       VALUES ($1,$2,'customer',$3,$4,'active', now(), $5, $6, CASE WHEN $5 THEN now() ELSE NULL END)
       RETURNING id`,
      // Ana has opted in to WhatsApp; the others have not, so the consent
      // gate is observable in the demo data.
      [c.email, passwordHash, c.fullName, c.phone, c.email === 'ana@ruvik.demo', c.phone],
    );
    customerIds.set(c.email, rows[0].id);
    await db.query('INSERT INTO customer_profiles (user_id, city) VALUES ($1,$2)', [rows[0].id, c.city]);
  }

  /* ----------------------------- providers ------------------------------ */
  const providerIds = new Map<string, string>();
  const providerUserIds = new Map<string, string>();

  for (const p of PROVIDERS) {
    const { rows: userRows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, full_name, phone_e164, status,
                          email_verified_at, whatsapp_opt_in, whatsapp_phone_e164, whatsapp_opt_in_at)
       VALUES ($1,$2,'provider',$3,$4,'active', now(), true, $4, now())
       RETURNING id`,
      [p.email, passwordHash, p.fullName, p.phone],
    );
    const userId = userRows[0].id;
    providerUserIds.set(p.email, userId);

    const { rows: provRows } = await db.query<{ id: string }>(
      `INSERT INTO providers (user_id, business_name, slug, tagline, bio, phone_e164,
                              whatsapp_phone_e164, city, country, years_experience,
                              verification_status, verified_at, is_published, working_hours,
                              certifications)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,'DO',$8,$9,
               CASE WHEN $9 = 'verified' THEN now() ELSE NULL END, true, $10, $11)
       RETURNING id`,
      [userId, p.businessName, slugify(p.businessName), p.tagline, p.bio, p.phone, p.city, p.years,
       p.verified ? 'verified' : 'pending',
       JSON.stringify({
         mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' },
         wed: { open: '08:00', close: '17:00' }, thu: { open: '08:00', close: '17:00' },
         fri: { open: '08:00', close: '17:00' }, sat: { open: '09:00', close: '13:00' },
         sun: { open: '00:00', close: '00:00', closed: true },
       }),
       JSON.stringify(p.verified ? ['Licensed contractor', 'Public liability insured'] : [])],
    );
    const providerId = provRows[0].id;
    providerIds.set(p.email, providerId);

    await db.query(
      `INSERT INTO subscriptions (provider_id, plan_id, status, current_period_start, current_period_end,
                                  external_ref)
       VALUES ($1,$2,$3, now(), now() + interval '1 month', $4)`,
      [providerId, planIds.get(p.plan), p.plan === 'starter' ? 'active' : 'active',
       `sub_demo_${p.plan}_${providerId.slice(0, 8)}`],
    );

    for (const s of p.services) {
      await db.query(
        `INSERT INTO services (provider_id, category_id, title, short_description, description,
                               pricing_type, price_cents, currency, estimated_duration_min,
                               coverage_area, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,'active')`,
        [providerId, categoryIds.get(p.category), s.title, s.short, s.description,
         s.pricing, s.price ?? null, s.duration ?? null, `${p.city} and surrounding areas`],
      );
    }
  }

  /* --------------------- jobs, quotes, invoices, reviews ---------------- */

  const plumbing = providerIds.get('greenleaf@ruvik.demo')!;
  const electric = providerIds.get('sparktech@ruvik.demo')!;
  const carpentry = providerIds.get('nordic@ruvik.demo')!;
  const hvac = providerIds.get('coolbreeze@ruvik.demo')!;

  const ana = customerIds.get('ana@ruvik.demo')!;
  const pedro = customerIds.get('pedro@ruvik.demo')!;
  const lucia = customerIds.get('lucia@ruvik.demo')!;
  const diego = customerIds.get('diego@ruvik.demo')!;

  // 1. Completed plumbing job with an accepted quote, a paid invoice and a review.
  await buildJourney(db, {
    providerId: plumbing, customerUserId: ana, customerName: 'Ana Reyes',
    email: 'ana@ruvik.demo', phone: '+18095551001', city: 'Santo Domingo',
    title: 'Master bathroom toilet running constantly',
    description: 'The toilet in the main bathroom keeps running after flushing and the water bill has jumped.',
    lines: [
      { description: 'Toilet repair — full valve replacement', quantity: 1, unitPriceCents: 12000, taxRateBp: 825 },
      { description: 'Labour (hours)', quantity: 1.5, unitPriceCents: 4500, taxRateBp: 825 },
    ],
    outcome: 'completed_paid_reviewed',
    rating: 5,
    reviewComment: 'Arrived on time, explained the problem clearly and fixed it in under two hours. The written quote matched the invoice exactly.',
  });

  // 2. Electrical job: quote sent, awaiting the customer's decision.
  await buildJourney(db, {
    providerId: electric, customerUserId: pedro, customerName: 'Pedro Martínez',
    email: 'pedro@ruvik.demo', phone: '+18095551002', city: 'Santiago',
    title: 'Breaker panel keeps tripping in the kitchen',
    description: 'The kitchen circuit trips whenever the microwave and kettle run together. House is from 1998.',
    lines: [
      { description: 'Electrical panel upgrade (200A)', quantity: 1, unitPriceCents: 45000, taxRateBp: 825 },
      { description: 'Dedicated kitchen circuit', quantity: 1, unitPriceCents: 9500, taxRateBp: 825 },
    ],
    outcome: 'quote_sent',
  });

  // 3. Carpentry job scheduled after acceptance, invoice not yet raised.
  await buildJourney(db, {
    providerId: carpentry, customerUserId: lucia, customerName: 'Lucía Guzmán',
    email: 'lucia@ruvik.demo', phone: '+18095551003', city: 'Santo Domingo',
    title: 'Fitted wardrobe for the main bedroom',
    description: 'Looking for a floor-to-ceiling wardrobe, roughly 3.2m wide, with sliding doors and internal drawers.',
    lines: [
      { description: 'Fitted wardrobe — design and build (3.2m)', quantity: 1, unitPriceCents: 185000, taxRateBp: 825 },
      { description: 'Sliding door upgrade', quantity: 2, unitPriceCents: 22000, taxRateBp: 825 },
    ],
    outcome: 'scheduled',
  });

  // 4. Fresh HVAC lead with no quote yet — the provider's inbox state.
  await buildJourney(db, {
    providerId: hvac, customerUserId: diego, customerName: 'Diego Fernández',
    email: 'diego@ruvik.demo', phone: '+18095551004', city: 'Punta Cana',
    title: 'AC not cooling in the living room',
    description: 'Split unit runs but the room never gets cold. It was serviced about two years ago.',
    lines: [],
    outcome: 'new_lead',
  });

  // 5. A second completed plumbing job so the provider has review history.
  await buildJourney(db, {
    providerId: plumbing, customerUserId: lucia, customerName: 'Lucía Guzmán',
    email: 'lucia@ruvik.demo', phone: '+18095551003', city: 'Santo Domingo',
    title: 'Kitchen sink draining slowly',
    description: 'Water pools in the sink and drains away very slowly. Plunger has not helped.',
    lines: [
      { description: 'Drain clearing and trap clean', quantity: 1, unitPriceCents: 6500, taxRateBp: 825 },
    ],
    outcome: 'completed_paid_reviewed',
    rating: 4,
    reviewComment: 'Good work and fair price. Would have liked a slightly wider arrival window, but the job was done properly.',
  });

  /* ------------------- pipeline depth for the demo provider ------------- */
  // The provider dashboard is the product's centrepiece, so the primary demo
  // account carries a realistic book of work: open leads, scheduled jobs,
  // unpaid invoices and six months of completed history.
  await buildPipeline(db, {
    providerId: plumbing,
    customers: [
      { userId: ana, name: 'Ana Reyes', email: 'ana@ruvik.demo', phone: '+18095551001' },
      { userId: pedro, name: 'Pedro Martínez', email: 'pedro@ruvik.demo', phone: '+18095551002' },
      { userId: lucia, name: 'Lucía Guzmán', email: 'lucia@ruvik.demo', phone: '+18095551003' },
      { userId: diego, name: 'Diego Fernández', email: 'diego@ruvik.demo', phone: '+18095551004' },
    ],
  });

  logger.info('demo data seeded');
}

/* -------------------------------------------------------------------------- */

interface JourneyInput {
  providerId: string;
  customerUserId: string;
  customerName: string;
  email: string;
  phone: string;
  city: string;
  title: string;
  description: string;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number; taxRateBp: number }>;
  outcome: 'new_lead' | 'quote_sent' | 'scheduled' | 'completed_paid_reviewed';
  rating?: number;
  reviewComment?: string;
}

/** Builds one end-to-end customer journey at the requested stage. */
async function buildJourney(db: Awaited<ReturnType<typeof getDb>>, input: JourneyInput): Promise<void> {
  await db.tx(async (c) => {
    const { rows: clientRows } = await c.query<{ id: string }>(
      `INSERT INTO clients (provider_id, user_id, full_name, email, phone_e164, whatsapp_phone_e164, city)
       VALUES ($1,$2,$3,$4,$5,$5,$6)
       ON CONFLICT (provider_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [input.providerId, input.customerUserId, input.customerName, input.email, input.phone, input.city],
    );
    const clientId = clientRows[0].id;

    const status =
      input.outcome === 'new_lead' ? 'new_lead'
      : input.outcome === 'quote_sent' ? 'quoted'
      : input.outcome === 'scheduled' ? 'scheduled'
      : 'completed';

    const reference = await nextNumber(c, input.providerId, 'job');
    const { rows: jobRows } = await c.query<{ id: string }>(
      `INSERT INTO jobs (provider_id, client_id, customer_user_id, reference, title, description,
                         city, status, source, scheduled_start, completed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'quote_request',
               CASE WHEN $8 IN ('scheduled','completed') THEN now() + interval '3 days' ELSE NULL END,
               CASE WHEN $8 = 'completed' THEN now() - interval '5 days' ELSE NULL END,
               now() - interval '12 days')
       RETURNING id`,
      [input.providerId, clientId, input.customerUserId, reference, input.title,
       input.description, input.city, status],
    );
    const jobId = jobRows[0].id;

    await c.query(
      `INSERT INTO job_status_events (job_id, from_status, to_status, note)
       VALUES ($1, NULL, 'new_lead', 'Request submitted by customer')`,
      [jobId],
    );

    if (input.outcome === 'new_lead') return;

    /* ------------------------------- quote ------------------------------ */
    const totals = computeTotals(input.lines, 0);
    const quoteNumber = await nextNumber(c, input.providerId, 'quote');
    const quoteStatus = input.outcome === 'quote_sent' ? 'sent' : 'accepted';

    const { rows: quoteRows } = await c.query<{ id: string }>(
      `INSERT INTO quotes (provider_id, job_id, number, status, currency, subtotal_cents,
                           discount_cents, tax_cents, total_cents, valid_until, notes, terms,
                           sent_at, accepted_at, created_at)
       VALUES ($1,$2,$3,$4,'USD',$5,$6,$7,$8, CURRENT_DATE + 14,
               'Thank you for the opportunity to quote for this work.',
               'Quote valid for 14 days. Payment due within 14 days of invoice.',
               now() - interval '10 days',
               CASE WHEN $4 = 'accepted' THEN now() - interval '8 days' ELSE NULL END,
               now() - interval '10 days')
       RETURNING id`,
      [input.providerId, jobId, quoteNumber, quoteStatus,
       totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
    );
    const quoteId = quoteRows[0].id;

    for (const [index, line] of totals.lines.entries()) {
      await c.query(
        `INSERT INTO quote_items (quote_id, description, quantity, unit_price_cents,
                                  tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [quoteId, line.description, line.quantity, line.unitPriceCents,
         line.taxRateBp, line.lineTotalCents, index],
      );
    }

    await c.query(
      `INSERT INTO job_notes (job_id, provider_id, author_user_id, body, visibility)
       VALUES ($1,$2,(SELECT user_id FROM providers WHERE id = $2),$3,'internal')`,
      [jobId, input.providerId, 'Spoke with the customer by phone — access available weekday mornings.'],
    );

    if (input.outcome === 'quote_sent') return;

    /* ------------------------------ invoice ----------------------------- */
    if (input.outcome !== 'completed_paid_reviewed') return;

    const invoiceNumber = await nextNumber(c, input.providerId, 'invoice');
    const { rows: invRows } = await c.query<{ id: string }>(
      `INSERT INTO invoices (provider_id, job_id, quote_id, client_id, number, status, currency,
                             issue_date, due_date, subtotal_cents, discount_cents, tax_cents,
                             total_cents, amount_paid_cents, notes, sent_at, paid_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'paid','USD', CURRENT_DATE - 5, CURRENT_DATE + 9,
               $6,$7,$8,$9,$9,'Thank you for your business.',
               now() - interval '5 days', now() - interval '2 days', now() - interval '5 days')
       RETURNING id`,
      [input.providerId, jobId, quoteId, clientId, invoiceNumber,
       totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
    );
    const invoiceId = invRows[0].id;

    for (const [index, line] of totals.lines.entries()) {
      await c.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents,
                                    tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [invoiceId, line.description, line.quantity, line.unitPriceCents,
         line.taxRateBp, line.lineTotalCents, index],
      );
    }

    await c.query(
      `INSERT INTO payments (provider_id, invoice_id, kind, amount_cents, currency, status, method, paid_at)
       VALUES ($1,$2,'invoice',$3,'USD','succeeded','transfer', now() - interval '2 days')`,
      [input.providerId, invoiceId, totals.totalCents],
    );

    await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [input.providerId]);

    /* ------------------------------- review ----------------------------- */
    if (input.rating) {
      await c.query(
        `INSERT INTO reviews (job_id, provider_id, customer_user_id, rating, comment, created_at)
         VALUES ($1,$2,$3,$4,$5, now() - interval '1 day')`,
        [jobId, input.providerId, input.customerUserId, input.rating, input.reviewComment ?? null],
      );
      await c.query(
        `UPDATE providers p SET
            rating_avg = COALESCE((SELECT round(avg(rating)::numeric,2) FROM reviews
                                    WHERE provider_id = p.id AND status = 'published'), 0),
            rating_count = (SELECT count(*) FROM reviews
                             WHERE provider_id = p.id AND status = 'published')
          WHERE p.id = $1`,
        [input.providerId],
      );
    }
  });
}

/* -------------------------------------------------------------------------- */

interface PipelineCustomer {
  userId: string;
  name: string;
  email: string;
  phone: string;
}

const OPEN_LEADS = [
  'Water heater making a knocking noise',
  'Outdoor tap dripping constantly',
  'Low water pressure in both showers',
  'Washing machine drain backing up',
];

const UPCOMING_WORK = [
  { title: 'Replace kitchen mixer tap', inDays: 2, cents: 8500 },
  { title: 'Bathroom re-pipe (first fix)', inDays: 5, cents: 62000 },
  { title: 'Annual boiler service', inDays: 9, cents: 9500 },
];

const HISTORY = [
  { title: 'Burst pipe under the sink', monthsAgo: 1, cents: 18500 },
  { title: 'Shower mixer replacement', monthsAgo: 2, cents: 14200 },
  { title: 'Blocked main drain clearance', monthsAgo: 2, cents: 22000 },
  { title: 'Toilet cistern rebuild', monthsAgo: 3, cents: 9800 },
  { title: 'Water tank replacement', monthsAgo: 4, cents: 47500 },
  { title: 'Radiator valve replacement', monthsAgo: 5, cents: 11200 },
];

const UNPAID = [
  { title: 'Emergency leak repair — kitchen', cents: 78000, dueInDays: 6 },
  { title: 'Garden irrigation line repair', cents: 67000, dueInDays: -4 },
];

/**
 * Gives a provider a believable book of work so the dashboard, calendar and
 * invoice screens all have something meaningful to show in the demo.
 */
async function buildPipeline(
  db: Awaited<ReturnType<typeof getDb>>,
  input: { providerId: string; customers: PipelineCustomer[] },
): Promise<void> {
  const { providerId, customers } = input;
  const pick = (index: number) => customers[index % customers.length];

  const clientFor = async (c: Awaited<ReturnType<typeof getDb>> | any, customer: PipelineCustomer) => {
    const { rows } = await c.query(
      `INSERT INTO clients (provider_id, user_id, full_name, email, phone_e164, whatsapp_phone_e164)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (provider_id, user_id) WHERE user_id IS NOT NULL
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [providerId, customer.userId, customer.name, customer.email, customer.phone],
    );
    return rows[0].id as string;
  };

  await db.tx(async (c) => {
    /* ------------------------------ open leads --------------------------- */
    for (const [index, title] of OPEN_LEADS.entries()) {
      const customer = pick(index);
      const clientId = await clientFor(c, customer);
      const reference = await nextNumber(c, providerId, 'job');
      const { rows } = await c.query(
        `INSERT INTO jobs (provider_id, client_id, customer_user_id, reference, title, description,
                           city, status, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Santo Domingo','new_lead','quote_request',
                 now() - ($7 || ' hours')::interval)
         RETURNING id`,
        [providerId, clientId, customer.userId, reference, title,
         'Submitted through the Ruvik app — awaiting a quote.', String((index + 1) * 7)],
      );
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, note)
         VALUES ($1, NULL, 'new_lead', 'Request submitted by customer')`,
        [rows[0].id],
      );
    }

    /* --------------------------- scheduled work -------------------------- */
    for (const [index, work] of UPCOMING_WORK.entries()) {
      const customer = pick(index + 1);
      const clientId = await clientFor(c, customer);
      const reference = await nextNumber(c, providerId, 'job');
      const { rows } = await c.query(
        `INSERT INTO jobs (provider_id, client_id, customer_user_id, reference, title,
                           city, status, source, scheduled_start, scheduled_end, created_at)
         VALUES ($1,$2,$3,$4,$5,'Santo Domingo','scheduled','quote_request',
                 date_trunc('hour', now()) + ($6 || ' days')::interval + interval '9 hours',
                 date_trunc('hour', now()) + ($6 || ' days')::interval + interval '12 hours',
                 now() - interval '6 days')
         RETURNING id`,
        [providerId, clientId, customer.userId, reference, work.title, String(work.inDays)],
      );

      const quoteNumber = await nextNumber(c, providerId, 'quote');
      const totals = computeTotals(
        [{ description: work.title, quantity: 1, unitPriceCents: work.cents, taxRateBp: 825 }], 0,
      );
      const { rows: quoteRows } = await c.query(
        `INSERT INTO quotes (provider_id, job_id, number, status, currency, subtotal_cents,
                             discount_cents, tax_cents, total_cents, sent_at, accepted_at, created_at)
         VALUES ($1,$2,$3,'accepted','USD',$4,$5,$6,$7,
                 now() - interval '5 days', now() - interval '4 days', now() - interval '5 days')
         RETURNING id`,
        [providerId, rows[0].id, quoteNumber,
         totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
      );
      await c.query(
        `INSERT INTO quote_items (quote_id, description, quantity, unit_price_cents,
                                  tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,1,$3,825,$4,0)`,
        [quoteRows[0].id, work.title, work.cents, totals.lines[0].lineTotalCents],
      );
      await c.query(
        `INSERT INTO job_status_events (job_id, from_status, to_status, note)
         VALUES ($1,'quoted','scheduled','Quote accepted and job booked in')`,
        [rows[0].id],
      );
    }

    /* -------------------------- outstanding money ------------------------ */
    for (const [index, unpaid] of UNPAID.entries()) {
      const customer = pick(index + 2);
      const clientId = await clientFor(c, customer);
      const reference = await nextNumber(c, providerId, 'job');
      const { rows } = await c.query(
        `INSERT INTO jobs (provider_id, client_id, customer_user_id, reference, title,
                           city, status, source, completed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'Santo Domingo','completed','quote_request',
                 now() - interval '12 days', now() - interval '25 days')
         RETURNING id`,
        [providerId, clientId, customer.userId, reference, unpaid.title],
      );

      const totals = computeTotals(
        [{ description: unpaid.title, quantity: 1, unitPriceCents: unpaid.cents, taxRateBp: 825 }], 0,
      );
      const invoiceNumber = await nextNumber(c, providerId, 'invoice');
      const { rows: invRows } = await c.query(
        `INSERT INTO invoices (provider_id, job_id, client_id, number, status, currency,
                               issue_date, due_date, subtotal_cents, discount_cents, tax_cents,
                               total_cents, amount_paid_cents, sent_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'USD',
                 CURRENT_DATE - 10, CURRENT_DATE + ($6)::integer,
                 $7,$8,$9,$10,0, now() - interval '10 days', now() - interval '10 days')
         RETURNING id`,
        [providerId, rows[0].id, clientId, invoiceNumber,
         unpaid.dueInDays < 0 ? 'overdue' : 'sent', String(unpaid.dueInDays),
         totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
      );
      await c.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents,
                                    tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,1,$3,825,$4,0)`,
        [invRows[0].id, unpaid.title, unpaid.cents, totals.lines[0].lineTotalCents],
      );
      await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [providerId]);
    }

    /* ----------------------- six months of history ----------------------- */
    for (const [index, past] of HISTORY.entries()) {
      const customer = pick(index);
      const clientId = await clientFor(c, customer);
      const reference = await nextNumber(c, providerId, 'job');
      const { rows } = await c.query(
        `INSERT INTO jobs (provider_id, client_id, customer_user_id, reference, title,
                           city, status, source, completed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'Santo Domingo','completed','quote_request',
                 now() - ($6 || ' months')::interval,
                 now() - ($6 || ' months')::interval - interval '9 days')
         RETURNING id`,
        [providerId, clientId, customer.userId, reference, past.title, String(past.monthsAgo)],
      );

      const totals = computeTotals(
        [{ description: past.title, quantity: 1, unitPriceCents: past.cents, taxRateBp: 825 }], 0,
      );
      const invoiceNumber = await nextNumber(c, providerId, 'invoice');
      const { rows: invRows } = await c.query(
        `INSERT INTO invoices (provider_id, job_id, client_id, number, status, currency,
                               issue_date, due_date, subtotal_cents, discount_cents, tax_cents,
                               total_cents, amount_paid_cents, sent_at, paid_at, created_at)
         VALUES ($1,$2,$3,$4,'paid','USD',
                 (now() - ($5 || ' months')::interval)::date,
                 (now() - ($5 || ' months')::interval)::date + 14,
                 $6,$7,$8,$9,$9,
                 now() - ($5 || ' months')::interval,
                 now() - ($5 || ' months')::interval + interval '4 days',
                 now() - ($5 || ' months')::interval)
         RETURNING id`,
        [providerId, rows[0].id, clientId, invoiceNumber, String(past.monthsAgo),
         totals.subtotalCents, totals.discountCents, totals.taxCents, totals.totalCents],
      );
      await c.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents,
                                    tax_rate_bp, line_total_cents, sort_order)
         VALUES ($1,$2,1,$3,825,$4,0)`,
        [invRows[0].id, past.title, past.cents, totals.lines[0].lineTotalCents],
      );
      await c.query(
        `INSERT INTO payments (provider_id, invoice_id, kind, amount_cents, currency, status, method, paid_at)
         VALUES ($1,$2,'invoice',$3,'USD','succeeded','transfer',
                 now() - ($4 || ' months')::interval + interval '4 days')`,
        [providerId, invRows[0].id, totals.totalCents, String(past.monthsAgo)],
      );
      await c.query('UPDATE providers SET completed_jobs = completed_jobs + 1 WHERE id = $1', [providerId]);
    }
  });
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntrypoint) {
  seed()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`Seed complete. Demo accounts use the password: ${DEMO_PASSWORD}`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
