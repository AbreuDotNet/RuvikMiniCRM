-- ============================================================================
-- Ruvik core schema (PostgreSQL 15+)
-- Money is stored as integer minor units (cents). Never floats.
-- Every provider-owned table carries provider_id for tenant isolation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- identity --
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  role                  text NOT NULL CHECK (role IN ('admin','provider','customer')),
  full_name             text NOT NULL,
  phone_e164            text,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','suspended','pending_deletion','deleted')),
  email_verified_at     timestamptz,
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_enc        text,
  mfa_recovery_codes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_login_count    integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  -- WhatsApp consent is explicit, revocable, and timestamped (GDPR art. 7)
  whatsapp_opt_in       boolean NOT NULL DEFAULT false,
  whatsapp_phone_e164   text,
  whatsapp_opt_in_at    timestamptz,
  whatsapp_opt_out_at   timestamptz,
  locale                text NOT NULL DEFAULT 'en',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
-- Case-insensitive uniqueness without the citext extension.
CREATE UNIQUE INDEX users_email_lower_uniq ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX users_role_status_idx ON users (role, status);
CREATE INDEX users_created_at_idx ON users (created_at DESC);

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,          -- sha256 of the opaque token
  family_id     uuid NOT NULL,                 -- rotation family; reuse => revoke family
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text,
  replaced_by   uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  user_agent    text,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id, expires_at DESC);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- ------------------------------------------------------------- catalogue ----
CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  icon        text NOT NULL DEFAULT 'wrench',
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_active_idx ON categories (is_active, sort_order);

-- -------------------------------------------------------------- providers ---
CREATE TABLE providers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name       text NOT NULL,
  slug                text NOT NULL UNIQUE,
  tagline             text,
  bio                 text,
  logo_file_id        uuid,
  phone_e164          text,
  whatsapp_phone_e164 text,
  address_line        text,
  city                text,
  region              text,
  country             text NOT NULL DEFAULT 'DO',
  postal_code         text,
  lat                 double precision,
  lng                 double precision,
  service_radius_km   integer NOT NULL DEFAULT 25 CHECK (service_radius_km BETWEEN 1 AND 500),
  working_hours       jsonb NOT NULL DEFAULT '{}'::jsonb,
  certifications      jsonb NOT NULL DEFAULT '[]'::jsonb,
  years_experience    integer,
  verification_status text NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  verification_note   text,
  verified_at         timestamptz,
  is_published        boolean NOT NULL DEFAULT false,
  rating_avg          numeric(3,2) NOT NULL DEFAULT 0,
  rating_count        integer NOT NULL DEFAULT 0,
  completed_jobs      integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  search_doc          tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple',
                          coalesce(business_name,'') || ' ' ||
                          coalesce(tagline,'')       || ' ' ||
                          coalesce(bio,'')           || ' ' ||
                          coalesce(city,'')          || ' ' ||
                          coalesce(region,''))
                      ) STORED
);
CREATE INDEX providers_published_idx  ON providers (is_published, verification_status);
CREATE INDEX providers_city_idx       ON providers (lower(city));
CREATE INDEX providers_rating_idx     ON providers (rating_avg DESC, rating_count DESC);
CREATE INDEX providers_search_idx     ON providers USING GIN (search_doc);
CREATE INDEX providers_geo_idx        ON providers (lat, lng);

CREATE TABLE customer_profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city        text,
  region      text,
  country     text NOT NULL DEFAULT 'DO',
  address_line text,
  lat         double precision,
  lng         double precision,
  avatar_file_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ files ---
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_id   uuid REFERENCES providers(id) ON DELETE CASCADE,
  storage_key   text NOT NULL UNIQUE,
  original_name text,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        text NOT NULL,
  kind          text NOT NULL DEFAULT 'image'
                  CHECK (kind IN ('image','document','quote_pdf','invoice_pdf','logo','avatar')),
  -- Uploads are quarantined until the scanner clears them.
  scan_status   text NOT NULL DEFAULT 'pending'
                  CHECK (scan_status IN ('pending','clean','infected','error')),
  scan_note     text,
  visibility    text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_provider_idx ON files (provider_id, kind);
CREATE INDEX files_owner_idx    ON files (owner_user_id);
CREATE INDEX files_sha_idx      ON files (sha256);

ALTER TABLE providers          ADD CONSTRAINT providers_logo_fk
  FOREIGN KEY (logo_file_id) REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE customer_profiles  ADD CONSTRAINT customer_avatar_fk
  FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

CREATE TABLE provider_portfolio_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caption     text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portfolio_provider_idx ON provider_portfolio_images (provider_id, sort_order);

-- --------------------------------------------------------------- services ---
CREATE TABLE services (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id          uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title                text NOT NULL,
  short_description    text,
  description          text,
  pricing_type         text NOT NULL CHECK (pricing_type IN ('fixed','starting_at','request_quote')),
  price_cents          integer CHECK (price_cents IS NULL OR price_cents >= 0),
  currency             text NOT NULL DEFAULT 'USD',
  estimated_duration_min integer CHECK (estimated_duration_min IS NULL OR estimated_duration_min > 0),
  coverage_area        text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused')),
  photos               jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  search_doc           tsvector GENERATED ALWAYS AS (
                         to_tsvector('simple',
                           coalesce(title,'') || ' ' ||
                           coalesce(short_description,'') || ' ' ||
                           coalesce(description,'') || ' ' ||
                           coalesce(coverage_area,''))
                       ) STORED,
  -- A fixed / starting_at listing must carry a price; request_quote must not.
  CONSTRAINT services_price_coherent CHECK (
    (pricing_type = 'request_quote' AND price_cents IS NULL)
    OR (pricing_type IN ('fixed','starting_at') AND price_cents IS NOT NULL)
  )
);
CREATE INDEX services_provider_idx  ON services (provider_id, status);
CREATE INDEX services_category_idx  ON services (category_id, status);
CREATE INDEX services_search_idx    ON services USING GIN (search_doc);
CREATE INDEX services_price_idx     ON services (pricing_type, price_cents);
CREATE INDEX services_active_created_idx ON services (status, created_at DESC, id DESC);

-- ------------------------------------------------------- provider CRM -------
CREATE TABLE clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,  -- set when a platform customer
  full_name     text NOT NULL,
  email         text,
  phone_e164    text,
  whatsapp_phone_e164 text,
  address_line  text,
  city          text,
  tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  search_doc    tsvector GENERATED ALWAYS AS (
                  to_tsvector('simple',
                    coalesce(full_name,'') || ' ' ||
                    coalesce(email,'') || ' ' ||
                    coalesce(phone_e164,''))
                ) STORED
);
CREATE INDEX clients_provider_idx ON clients (provider_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX clients_provider_user_uniq ON clients (provider_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX clients_search_idx ON clients USING GIN (search_doc);

CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id      uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  customer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  service_id       uuid REFERENCES services(id) ON DELETE SET NULL,
  reference        text NOT NULL,
  title            text NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'new_lead' CHECK (status IN
                     ('new_lead','contacted','quoted','approved','scheduled',
                      'in_progress','completed','cancelled')),
  source           text NOT NULL DEFAULT 'quote_request'
                     CHECK (source IN ('quote_request','manual','import','referral')),
  address_line     text,
  city             text,
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX jobs_provider_reference_uniq ON jobs (provider_id, reference);
CREATE INDEX jobs_provider_status_idx ON jobs (provider_id, status, created_at DESC, id DESC);
CREATE INDEX jobs_customer_idx        ON jobs (customer_user_id, created_at DESC, id DESC);
CREATE INDEX jobs_client_idx          ON jobs (client_id, created_at DESC);
CREATE INDEX jobs_schedule_idx        ON jobs (provider_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL;

CREATE TABLE job_status_events (
  id          bigserial PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_status_events_job_idx ON job_status_events (job_id, created_at DESC);

CREATE TABLE job_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL,
  -- 'internal' notes are never serialised to customer-facing responses.
  visibility     text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','customer')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_notes_job_idx ON job_notes (job_id, created_at DESC);

-- ------------------------------------------------------ quotes & invoices ---
CREATE TABLE quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  number        text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','accepted','declined','expired','cancelled')),
  currency      text NOT NULL DEFAULT 'USD',
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents     integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents   integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  valid_until   date,
  notes         text,
  terms         text,
  pdf_file_id   uuid REFERENCES files(id) ON DELETE SET NULL,
  pdf_sha256    text,
  -- Opaque share token lets a customer open the quote by link without an account.
  share_token_hash text,
  sent_at       timestamptz,
  accepted_at   timestamptz,
  declined_at   timestamptz,
  decline_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quotes_provider_number_uniq ON quotes (provider_id, number);
CREATE INDEX quotes_provider_status_idx ON quotes (provider_id, status, created_at DESC, id DESC);
CREATE INDEX quotes_job_idx ON quotes (job_id);

CREATE TABLE quote_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp     integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  line_total_cents integer NOT NULL DEFAULT 0,
  sort_order      integer NOT NULL DEFAULT 0
);
CREATE INDEX quote_items_quote_idx ON quote_items (quote_id, sort_order);

CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  job_id         uuid REFERENCES jobs(id) ON DELETE SET NULL,
  quote_id       uuid REFERENCES quotes(id) ON DELETE SET NULL,
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  number         text NOT NULL,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','partially_paid','paid','overdue','void')),
  currency       text NOT NULL DEFAULT 'USD',
  issue_date     date NOT NULL DEFAULT CURRENT_DATE,
  due_date       date,
  subtotal_cents integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents      integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents integer NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  notes          text,
  pdf_file_id    uuid REFERENCES files(id) ON DELETE SET NULL,
  pdf_sha256     text,
  share_token_hash text,
  sent_at        timestamptz,
  paid_at        timestamptz,
  voided_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_provider_number_uniq ON invoices (provider_id, number);
CREATE INDEX invoices_provider_status_idx ON invoices (provider_id, status, issue_date DESC, id DESC);
CREATE INDEX invoices_job_idx ON invoices (job_id);
CREATE INDEX invoices_due_idx ON invoices (status, due_date) WHERE status IN ('sent','partially_paid','overdue');

CREATE TABLE invoice_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate_bp     integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  line_total_cents integer NOT NULL DEFAULT 0,
  sort_order      integer NOT NULL DEFAULT 0
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items (invoice_id, sort_order);

-- ------------------------------------------------ subscriptions & billing ---
CREATE TABLE subscription_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  currency     text NOT NULL DEFAULT 'USD',
  interval     text NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
  trial_days   integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  max_services integer,
  max_quotes_per_month integer,
  features     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  plan_id        uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'pending_payment'
                   CHECK (status IN ('pending_payment','trialing','active','past_due','cancelled','expired')),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at   timestamptz,
  external_ref   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- A provider has at most one live subscription.
CREATE UNIQUE INDEX subscriptions_one_live_per_provider
  ON subscriptions (provider_id)
  WHERE status IN ('pending_payment','trialing','active','past_due');
CREATE INDEX subscriptions_status_idx ON subscriptions (status, current_period_end);

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid REFERENCES providers(id) ON DELETE SET NULL,
  invoice_id     uuid REFERENCES invoices(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  kind           text NOT NULL CHECK (kind IN ('subscription','invoice')),
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  currency       text NOT NULL DEFAULT 'USD',
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','succeeded','failed','refunded')),
  method         text,
  external_ref   text,
  failure_reason text,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_provider_idx ON payments (provider_id, created_at DESC);
CREATE INDEX payments_invoice_idx  ON payments (invoice_id);
CREATE UNIQUE INDEX payments_external_ref_uniq ON payments (external_ref) WHERE external_ref IS NOT NULL;

-- ------------------------------------------------------ reviews & support ---
CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  provider_id      uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating           integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          text,
  status           text NOT NULL DEFAULT 'published'
                     CHECK (status IN ('published','flagged','removed')),
  provider_reply   text,
  replied_at       timestamptz,
  moderated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  moderation_note  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_provider_idx ON reviews (provider_id, status, created_at DESC, id DESC);
CREATE INDEX reviews_customer_idx ON reviews (customer_user_id);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, priority, created_at DESC);

-- ------------------------------------------------------------ messaging ----
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE whatsapp_consents (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  action     text NOT NULL CHECK (action IN ('opt_in','opt_out')),
  source     text NOT NULL,     -- settings_ui | whatsapp_stop | admin | signup
  ip         text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_consents_user_idx ON whatsapp_consents (user_id, created_at DESC);

-- Message log deliberately stores NO message body: only routing + status.
CREATE TABLE whatsapp_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_id         uuid REFERENCES providers(id) ON DELETE SET NULL,
  to_phone_masked     text NOT NULL,   -- e.g. +1809*****42
  to_phone_hash       text NOT NULL,   -- hmac for correlation without storing PII
  template_name       text NOT NULL,
  template_language   text NOT NULL DEFAULT 'en',
  related_type        text CHECK (related_type IN ('quote','invoice','job','subscription')),
  related_id          uuid,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','delivered','read','failed','skipped_no_consent')),
  wa_message_id       text,
  error_code          text,
  error_detail        text,
  idempotency_key     text NOT NULL UNIQUE,
  attempts            integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_messages_status_idx ON whatsapp_messages (status, created_at DESC);
CREATE INDEX whatsapp_messages_wa_id_idx  ON whatsapp_messages (wa_message_id);
CREATE INDEX whatsapp_messages_related_idx ON whatsapp_messages (related_type, related_id);

-- ------------------------------------------------- infrastructure tables ----
-- Durable job queue. Postgres-backed so the platform runs without Redis;
-- Redis is used for caching/rate limiting when REDIS_URL is configured.
CREATE TABLE job_queue (
  id           bigserial PRIMARY KEY,
  queue        text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','done','failed','dead')),
  run_at       timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error   text,
  locked_at    timestamptz,
  locked_by    text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_poll_idx ON job_queue (status, run_at, id);
CREATE UNIQUE INDEX job_queue_dedupe_uniq ON job_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending','processing');

CREATE TABLE dead_letters (
  id          bigserial PRIMARY KEY,
  queue       text NOT NULL,
  payload     jsonb NOT NULL,
  attempts    integer NOT NULL,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Signed-webhook replay protection.
CREATE TABLE webhook_events (
  id                 bigserial PRIMARY KEY,
  source             text NOT NULL CHECK (source IN ('billing','whatsapp')),
  external_id        text NOT NULL,
  event_type         text,
  signature_verified boolean NOT NULL DEFAULT false,
  payload            jsonb NOT NULL,
  processed_at       timestamptz,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX webhook_events_source_external_uniq ON webhook_events (source, external_id);

CREATE TABLE idempotency_keys (
  key             text PRIMARY KEY,
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- Append-only, hash-chained audit trail. No UPDATE/DELETE path in application code.
CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_user_id uuid,
  actor_role   text,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  ip           text,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text,
  hash         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE number_sequences (
  provider_id uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('quote','invoice','job')),
  period      text NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, kind, period)
);
