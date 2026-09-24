-- ===========================================================================
-- The country nobody chose
-- ===========================================================================
--
-- `providers.country` and `customer_profiles.country` have defaulted to 'DO'
-- since 001_init — the Dominican Republic, from before this product was aimed
-- at the United States. Migration 002 records the other half of that history:
-- the app "previously defaulted to 18%, which is the Dominican ITBIS and is
-- not a US sales tax rate anywhere".
--
-- The rate was fixed. The country was not.
--
-- What makes this safe to correct rather than a question for the business:
--
--   * `createUser` in modules/auth/service.ts inserts a provider or a customer
--     profile **without a country column at all**, so every account created
--     through the real signup flow takes the default.
--   * No screen on web or mobile writes it. The provider profile PATCH accepts
--     `country`, and nothing sends it; the admin panel and the mobile types
--     only read it back.
--   * The seed is the sole writer, and it always writes 'US' explicitly.
--
-- So no row holding 'DO' was ever set to 'DO' by a person — the column chose
-- it for them, on a product whose state validation, tax-rate ceiling and
-- entire document model are United States only. Backfilling is restoring an
-- answer nobody gave, not overriding one somebody did.
--
-- This does not add international support. It makes the stored value match the
-- only country the product currently works in. Giving a user a real choice
-- means a field on signup and a profile screen that writes it, and that is a
-- feature rather than a correction.
-- ===========================================================================

ALTER TABLE providers          ALTER COLUMN country SET DEFAULT 'US';
ALTER TABLE customer_profiles  ALTER COLUMN country SET DEFAULT 'US';

UPDATE providers         SET country = 'US', updated_at = now() WHERE country = 'DO';
UPDATE customer_profiles SET country = 'US', updated_at = now() WHERE country = 'DO';
