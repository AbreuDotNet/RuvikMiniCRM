-- The master role.
--
-- The platform owner: acts as every other role and is bound by no plan limit.
-- It is a role rather than a flag on the admin row because the token already
-- carries a role, every guard already reads one, and a second parallel
-- mechanism would be a second thing to forget.
--
-- What it is not: a way past two-factor, past tenant isolation, or past
-- signing in. Those are in `lib/roles.ts`, next to the containment table.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'provider', 'customer', 'master'));

/*
 * A master is never created through the API.
 *
 * There is no endpoint that grants the role to someone who does not have it:
 * an admin who could promote would promote themselves, and the hierarchy
 * would mean nothing. Masters are seeded, or granted by another master
 * directly against the database.
 *
 * This index is the operational counterpart — it makes "who has this?" a
 * lookup rather than a scan, which matters when the answer needs to be
 * checked rather than assumed.
 */
CREATE INDEX IF NOT EXISTS users_master_idx
  ON users (id) WHERE role = 'master';

-- `audit_logs.actor_role` is free text and already accepts anything, so it
-- needs no change; a master's actions land in the same trail as everyone
-- else's, which is the point.
