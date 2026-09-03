-- ===========================================================================
-- Provider lifecycle: two axes, one history
-- ===========================================================================
--
-- Verification answers "did we check their documents?".
-- Account status answers "may they operate right now?".
--
-- These are deliberately kept apart. Folding them into a single enum loses
-- information: a verified provider who is suspended and later reinstated must
-- return to *verified*, and a single column cannot remember that. Keeping two
-- axes means reinstatement never has to guess, and the effective state the
-- admin sees is derived rather than stored.
-- ===========================================================================

/* ------------------------------ verification ------------------------------ */

-- 'info_requested' is the state between pending and a decision: the reviewer
-- has looked, something is missing, and the ball is in the provider's court.
-- Without it, "we asked for the licence number" has to live as a rejection,
-- which is both wrong and unrecoverable from the provider's side.
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_verification_status_check;
ALTER TABLE providers ADD CONSTRAINT providers_verification_status_check
  CHECK (verification_status IN ('unverified','pending','info_requested','verified','rejected'));

/* -------------------------------- account -------------------------------- */

-- 'blocked' is terminal where 'suspended' is temporary. Both revoke sessions,
-- but they are different decisions and reversing them carries a different
-- bar, so they must be distinguishable after the fact.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','suspended','blocked','pending_deletion','deleted'));

-- The reason currently in force, denormalised so a list of 40 users does not
-- need 40 lateral lookups into the history table. The history remains the
-- source of truth for everything but "why is this account like this today".
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

/* -------------------------------- history -------------------------------- */

-- audit_logs is the tamper-evident record of *who did what to the platform*.
-- This is the readable timeline of *what happened to one provider* — a
-- different question, asked constantly during a review, and answering it from
-- a hash chain would mean scanning it. Both are written on every transition.
CREATE TABLE IF NOT EXISTS provider_status_events (
  id            bigserial PRIMARY KEY,
  provider_id   uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  axis          text NOT NULL CHECK (axis IN ('verification','account')),
  action        text NOT NULL,
  from_status   text,
  to_status     text NOT NULL,
  -- Required by the API for every destructive action; nullable here because
  -- approving does not need one.
  reason        text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_status_events_provider_idx
  ON provider_status_events (provider_id, id DESC);

/* ---------------------------- verification queue --------------------------- */

-- When the provider last entered the review queue. Drives "oldest waiting"
-- ordering on the admin queue, which is the only ordering that stops a
-- submission from starving behind newer ones.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS verification_requested_at timestamptz;

UPDATE providers
   SET verification_requested_at = COALESCE(verification_requested_at, updated_at)
 WHERE verification_status IN ('pending','info_requested');

/* ------------------------- auth level across refresh ----------------------- */

-- Access tokens carry `aal`, but /auth/refresh re-signed them without it, so
-- an MFA-elevated admin silently dropped to aal1 after one token lifetime and
-- every requireMfa route started returning 403 until they signed in again.
-- The level belongs to the session, so it is stored with the refresh token
-- and carried across rotation.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS aal text NOT NULL DEFAULT 'aal1'
  CHECK (aal IN ('aal1','mfa'));
