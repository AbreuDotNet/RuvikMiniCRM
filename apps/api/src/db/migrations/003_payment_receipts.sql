-- Payment receipts: a printable record of one payment, distinct from the
-- invoice it settles.
--
-- An invoice says what is owed; a receipt says what was handed over and when.
-- They are not the same document and cannot share a number: a partly-paid
-- invoice produces several receipts, and a customer who paid in three
-- instalments is entitled to three separate proofs.
--
-- The number is assigned when the payment is recorded and never changes, so
-- reprinting a receipt reproduces the original rather than issuing a new one.

ALTER TABLE number_sequences
  DROP CONSTRAINT IF EXISTS number_sequences_kind_check;

ALTER TABLE number_sequences
  ADD CONSTRAINT number_sequences_kind_check
  CHECK (kind IN ('quote', 'invoice', 'job', 'receipt'));

ALTER TABLE payments
  ADD COLUMN receipt_number text,
  -- Set the first time a receipt for this payment is actually printed, so a
  -- provider can tell an unprinted payment from one the customer has a copy of.
  ADD COLUMN receipt_printed_at timestamptz;

-- Per provider, like every other document number in this system.
CREATE UNIQUE INDEX payments_receipt_number_uniq
  ON payments (provider_id, receipt_number)
  WHERE receipt_number IS NOT NULL;

-- Backfill: existing payments have no receipt number and will get one the
-- first time a receipt is requested for them. Assigning numbers here would
-- put them out of chronological order with the ones issued from now on.
