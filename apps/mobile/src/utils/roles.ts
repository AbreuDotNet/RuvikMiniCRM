/**
 * Which roles contain which — the client's copy of the server's table.
 *
 * This is a mirror of `apps/api/src/lib/roles.ts`, and it exists for exactly
 * one job: deciding which tab group to show a signed-in user. It is
 * navigation, not permission. Every screen behind these checks calls an
 * endpoint that asks the server the same question, and a session that reached
 * a group it should not have gets 403s instead of data. If the two tables ever
 * disagree, the server's answer is the real one.
 *
 * It is a copy rather than an import because the app does not build from the
 * API's source. Keeping the shape identical is deliberate: when the server
 * table changes, the diff here should look the same.
 */

export const ROLES = ['customer', 'provider', 'admin', 'master'] as const;

export type Role = (typeof ROLES)[number];

const CONTAINS: Record<Role, readonly Role[]> = {
  customer: ['customer'],
  provider: ['provider'],
  admin: ['admin'],
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
