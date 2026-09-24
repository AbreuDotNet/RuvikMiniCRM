/**
 * Roles, and which ones contain which.
 *
 * `master` is the platform owner: it acts as every other role, and no plan
 * limit applies to it. It exists because someone has to be able to work on the
 * live product without a subscription standing in the way.
 *
 * The containment table is the whole point of this file. A role that means
 * "everything" is only safe if there is exactly one place that decides what
 * everything is — otherwise it gets added to `requireRole('admin')` and
 * forgotten at `requireProvider`, and the answer to "can master do X?" becomes
 * "depends which route you ask".
 *
 * What master deliberately does **not** bypass:
 *
 *   * **Two-factor.** `requireMfa` applies to master exactly as it does to an
 *     admin. A role with no limits that also skips the second factor is the
 *     single most valuable account to steal, and the easiest to abuse once
 *     stolen. No product limit is worth that.
 *   * **Tenant isolation.** Master still reads its own provider's data on
 *     provider routes. Reading someone else's books is impersonation, which
 *     needs its own design — consent, a time limit, an audit entry per read —
 *     not a role flag.
 *   * **Authentication.** Master signs in like everybody else.
 */

export const ROLES = ['customer', 'provider', 'admin', 'master'] as const;

export type Role = (typeof ROLES)[number];

/** The roles a signed-in role is allowed to act as. */
const CONTAINS: Record<Role, readonly Role[]> = {
  customer: ['customer'],
  provider: ['provider'],
  admin: ['admin'],
  // Ordered widest-first so a reader sees immediately that this is the
  // superset, not another peer.
  master: ['master', 'admin', 'provider', 'customer'],
};

/** Whether `role` may act as `target`. */
export function actsAs(role: Role, target: Role): boolean {
  return CONTAINS[role].includes(target);
}

/** Whether `role` may act as any of `targets`. */
export function actsAsAny(role: Role, targets: readonly Role[]): boolean {
  return targets.some((target) => actsAs(role, target));
}

export function isMaster(role: Role | undefined | null): boolean {
  return role === 'master';
}

/**
 * Roles an administrator is allowed to act on.
 *
 * Master is absent on purpose. An admin who could suspend, delete or re-role a
 * master could remove the only account above them, and an admin who could
 * *promote* to master could simply grant it to themselves — either way the
 * hierarchy would exist only on paper.
 */
export const ADMIN_MANAGEABLE_ROLES: readonly Role[] = ['customer', 'provider', 'admin'];

export function canAdminManage(actorRole: Role, targetRole: Role): boolean {
  if (isMaster(actorRole)) return true;
  return ADMIN_MANAGEABLE_ROLES.includes(targetRole);
}
