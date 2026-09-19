-- ===========================================================================
-- Invoice evidence: what was sold, where the work was, and how it was priced
-- ===========================================================================
--
-- The previous model recorded a tax treatment and a reason per line, which is
-- the *conclusion*. It did not record the facts the conclusion rests on, and
-- every state rule for this trade turns on those facts:
--
--   Texas  — labour on residential real property is outside the tax while
--            materials are taxable, AND whether the customer is charged at all
--            depends on the contract being lump-sum or separated.
--            (Comptroller 94-116, Rule 3.291)
--   New York — a capital improvement is relieved only when the customer hands
--            over Form ST-124; a repair is taxable on labour and materials
--            alike. (TB-ST-104 / TB-ST-113, Publication 862)
--   Arizona — contracting is taxed under its own privilege classification on
--            the contractor's receipts, not as a retail sale. (A.R.S. 42-5075)
--
-- None of those can be evidenced from "tax_treatment = 'not_subject'" alone.
-- This migration stores the underlying facts so a document issued today can
-- still be explained to an auditor in three years.
--
-- It decides nothing. Every column records a choice the provider made.
-- ===========================================================================

/* ------------------------------ what was sold ----------------------------- */

-- Materials and labour are the axis nearly every state splits on, so which one
-- a line is cannot be left to the wording of a free-text description.
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'other'
  CHECK (line_kind IN ('materials','labour','equipment','fee','reimbursement','deposit','other'));
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS line_kind text NOT NULL DEFAULT 'other'
  CHECK (line_kind IN ('materials','labour','equipment','fee','reimbursement','deposit','other'));

/* --------------------------- manual adjustments --------------------------- */

-- A fourth treatment: the tax on this line was set by a human rather than
-- derived. It is not the same as exempt or out of scope, and an auditor asks
-- about it differently, so it is recorded as what it is.
ALTER TABLE quote_items DROP CONSTRAINT IF EXISTS quote_items_tax_treatment_check;
ALTER TABLE quote_items ADD CONSTRAINT quote_items_tax_treatment_check
  CHECK (tax_treatment IN ('taxable','exempt','not_subject','manual_adjustment'));

ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tax_treatment_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_tax_treatment_check
  CHECK (tax_treatment IN ('taxable','exempt','not_subject','manual_adjustment'));

-- Where a state requires the seller to hold a certificate to justify relief —
-- New York's ST-124 for a capital improvement, a resale or exemption
-- certificate elsewhere — this is where its reference lives. Free text: the
-- form number and identifier differ by state, and inventing a schema for all
-- of them would fit none.
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS tax_exemption_certificate text;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_exemption_certificate text;

/* ---------------------------- where the work was -------------------------- */

-- Most states source sales tax to where the work is performed or delivered,
-- not to where the contractor is registered. The document previously snapshot
-- only the provider's own state, which is the right answer only when both
-- happen to coincide.
--
-- Nullable on purpose: a blank is an honest "not recorded". Defaulting to the
-- provider's own address would assert a jurisdiction nobody chose.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_address_line text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_city text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_region text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_postal_code text;

-- When the work was done, which is not the issue date and is what determines
-- the rate in force and the period the tax belongs to.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_date date;

/* ------------------------------ how it was priced ------------------------- */

-- Texas treats a lump-sum contract and a separated contract as different
-- transactions: under lump-sum the contractor pays tax on materials at
-- purchase and charges the customer none; under separated the contractor buys
-- materials for resale and collects tax from the customer. Itemising labour
-- and materials on the document is itself the election, so the document has to
-- say which one it is rather than leave it to be inferred.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'not_specified'
  CHECK (contract_type IN ('lump_sum','separated','not_specified'));
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'not_specified'
  CHECK (contract_type IN ('lump_sum','separated','not_specified'));

/* --------------------------------- viewed --------------------------------- */

-- first_viewed_at was added in 002 and never written or read: 'sent' and
-- 'viewed' stayed the same thing to the provider chasing payment.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','viewed','partially_paid','paid','overdue','void'));

CREATE INDEX IF NOT EXISTS invoices_service_region_idx
  ON invoices (provider_id, service_region) WHERE service_region IS NOT NULL;
