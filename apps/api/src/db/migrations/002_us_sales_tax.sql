-- US sales tax: per-line treatment, a reason when tax is not charged, and the
-- jurisdiction the document was priced under.
--
-- The previous model carried one rate per line and nothing else, which cannot
-- express how US sales tax actually works on this trade. States differ on the
-- same job: New York taxes both materials and labour on a repair to real
-- property, while Texas taxes materials but not the labour when the property
-- is residential, and taxes both when it is not. A rate alone also cannot say
-- *why* nothing was charged, and "exempt" and "out of scope" are different
-- answers an auditor will ask to see evidenced separately.
--
-- Nothing here decides taxability for the provider. It records the decision
-- they made, so the document is reproducible later.

-- ------------------------------------------------------------ providers ---
ALTER TABLE providers
  -- Two-letter state whose rules the provider bills under. Null until set:
  -- guessing a jurisdiction would be worse than leaving it unanswered.
  ADD COLUMN tax_state text CHECK (tax_state IS NULL OR tax_state ~ '^[A-Z]{2}$'),
  -- Combined state + local rate the provider normally applies, in basis
  -- points. Deliberately per provider: there is no national US sales tax and
  -- no single rate that is correct everywhere.
  ADD COLUMN default_tax_rate_bp integer NOT NULL DEFAULT 0
    CHECK (default_tax_rate_bp BETWEEN 0 AND 10000),
  ADD COLUMN tax_jurisdiction_note text;

-- --------------------------------------------------------------- quotes ---
ALTER TABLE quotes
  ADD COLUMN taxable_base_cents integer NOT NULL DEFAULT 0 CHECK (taxable_base_cents >= 0),
  ADD COLUMN untaxed_base_cents integer NOT NULL DEFAULT 0 CHECK (untaxed_base_cents >= 0),
  -- Snapshot: the jurisdiction as it stood when the document was priced. The
  -- provider's current setting must not rewrite history on an issued document.
  ADD COLUMN tax_jurisdiction text;

ALTER TABLE quote_items
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable'
    CHECK (tax_treatment IN ('taxable', 'exempt', 'not_subject')),
  ADD COLUMN tax_reason text,
  -- Amount of the document discount allocated here, and the base tax was
  -- charged on. Stored rather than recomputed so a reissued PDF cannot drift
  -- from the figures the customer already accepted.
  ADD COLUMN line_discount_cents integer NOT NULL DEFAULT 0 CHECK (line_discount_cents >= 0),
  ADD COLUMN line_taxable_base_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN line_tax_cents integer NOT NULL DEFAULT 0;

-- A relieved line without a stated reason is exactly what an audit asks about.
ALTER TABLE quote_items
  ADD CONSTRAINT quote_items_reason_required
  CHECK (tax_treatment = 'taxable' OR (tax_reason IS NOT NULL AND length(btrim(tax_reason)) > 0));

-- ------------------------------------------------------------- invoices ---
ALTER TABLE invoices
  ADD COLUMN taxable_base_cents integer NOT NULL DEFAULT 0 CHECK (taxable_base_cents >= 0),
  ADD COLUMN untaxed_base_cents integer NOT NULL DEFAULT 0 CHECK (untaxed_base_cents >= 0),
  ADD COLUMN tax_jurisdiction text,
  -- Set when a human overrode the computed tax, with the reason. Never
  -- silently: an adjusted total has to be attributable.
  ADD COLUMN tax_override_reason text,
  -- First time the customer opened the share link, so 'sent' and 'viewed'
  -- stop being the same thing.
  ADD COLUMN first_viewed_at timestamptz;

ALTER TABLE invoice_items
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable'
    CHECK (tax_treatment IN ('taxable', 'exempt', 'not_subject')),
  ADD COLUMN tax_reason text,
  ADD COLUMN line_discount_cents integer NOT NULL DEFAULT 0 CHECK (line_discount_cents >= 0),
  ADD COLUMN line_taxable_base_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN line_tax_cents integer NOT NULL DEFAULT 0;

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_reason_required
  CHECK (tax_treatment = 'taxable' OR (tax_reason IS NOT NULL AND length(btrim(tax_reason)) > 0));

-- Backfill: every existing line was taxed at its stated rate, so 'taxable'
-- (the column default) is already right and needs no reason. The stored bases
-- are recomputed from what is there rather than left at zero.
UPDATE quote_items
   SET line_taxable_base_cents = round(quantity * unit_price_cents),
       line_tax_cents = round(round(quantity * unit_price_cents) * tax_rate_bp / 10000.0);
UPDATE invoice_items
   SET line_taxable_base_cents = round(quantity * unit_price_cents),
       line_tax_cents = round(round(quantity * unit_price_cents) * tax_rate_bp / 10000.0);

UPDATE quotes   SET taxable_base_cents = greatest(subtotal_cents - discount_cents, 0);
UPDATE invoices SET taxable_base_cents = greatest(subtotal_cents - discount_cents, 0);
