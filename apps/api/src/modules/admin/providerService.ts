import { getDb, type Queryable } from '../../db/index.js';
import { writeAudit } from '../../lib/audit.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { notify } from '../notifications/service.js';
import { badRequest, notFound, conflict } from '../../lib/errors.js';
import {
  actionSpec, effectiveState, MIN_REASON_LENGTH,
  type EffectiveState, type ProviderAction,
} from '../../lib/providerLifecycle.js';

export interface ActionContext {
  ip?: string;
  userAgent?: string;
}

export interface ActionOutcome {
  id: string;
  verificationStatus: string;
  accountStatus: string;
  state: EffectiveState;
  previousState: EffectiveState;
}

interface LockedProvider {
  id: string;
  user_id: string;
  business_name: string;
  verification_status: string;
  is_published: boolean;
  verification_requested_at: string | null;
  user_status: string;
}

/**
 * Applies one lifecycle action to a provider.
 *
 * Everything happens in a single transaction with both rows locked. Two admins
 * opening the same provider is the normal case in a review queue, and without
 * the lock the second one's decision would be evaluated against a state that
 * no longer exists — approving someone the first admin just blocked.
 *
 * Session revocation and the notification are deliberately *outside* the
 * transaction: they are not rollback-able, and a failed push must not undo a
 * suspension that the database has already committed.
 */
export async function applyProviderAction(input: {
  providerId: string;
  action: ProviderAction;
  reason?: string | null;
  actorUserId: string;
  ctx: ActionContext;
}): Promise<ActionOutcome> {
  const spec = actionSpec(input.action);
  if (!spec) throw badRequest(`Unknown action "${input.action}".`);

  const reason = (input.reason ?? '').trim();
  if (spec.requiresReason && reason.length < MIN_REASON_LENGTH) {
    throw badRequest(
      `"${spec.label}" needs a reason of at least ${MIN_REASON_LENGTH} characters. `
      + 'It is written to the provider history and read when the decision is questioned.',
    );
  }

  const db = await getDb();

  const result = await db.tx(async (c) => {
    const { rows } = await c.query<LockedProvider>(
      `SELECT p.id, p.user_id, p.business_name, p.verification_status, p.is_published,
              p.verification_requested_at, u.status AS user_status
         FROM providers p
         JOIN users u ON u.id = p.user_id
        WHERE p.id = $1
          FOR UPDATE`,
      [input.providerId],
    );
    const row = rows[0];
    if (!row) throw notFound('Provider not found.');

    const previousState = effectiveState({
      verificationStatus: row.verification_status,
      accountStatus: row.user_status,
    });

    if (!spec.from.includes(previousState)) {
      throw conflict(
        `"${spec.label}" is not available while this provider is ${previousState.replace(/_/g, ' ')}. `
        + 'Reload the provider — someone may have changed it while you were reading.',
      );
    }

    if (spec.axis === 'verification') {
      await applyVerification(c, row, spec.to, reason);
    } else {
      await applyAccount(c, row, spec.to, reason);
    }

    await c.query(
      `INSERT INTO provider_status_events
         (provider_id, actor_user_id, axis, action, from_status, to_status, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.id, input.actorUserId, spec.axis, spec.action,
        spec.axis === 'verification' ? row.verification_status : row.user_status,
        spec.to,
        reason || null,
        JSON.stringify({ wasPublished: row.is_published, previousState }),
      ],
    );

    const { rows: after } = await c.query<{ verification_status: string; user_status: string }>(
      `SELECT p.verification_status, u.status AS user_status
         FROM providers p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
      [row.id],
    );

    return { row, previousState, after: after[0] };
  });

  // Suspension and blocking must bite now, not when the access token expires.
  if (spec.to === 'suspended' || spec.to === 'blocked') {
    await revokeAllForUser(result.row.user_id, `admin_${spec.action}`);
  }

  await notify(result.row.user_id, notificationFor(input.action, reason));

  // The audit action names predate the lifecycle vocabulary and are what
  // existing filters, exports and the audit screen query. They stay; the
  // specific action rides in the metadata.
  await writeAudit({
    actorUserId: input.actorUserId,
    actorRole: 'admin',
    action: spec.axis === 'verification'
      ? 'admin.provider_verification'
      : `admin.user_${spec.to}`,
    // Likewise the entity: an account-status change is recorded against the
    // user, as it was before providers had a lifecycle of their own.
    entityType: spec.axis === 'verification' ? 'provider' : 'user',
    entityId: spec.axis === 'verification' ? result.row.id : result.row.user_id,
    ip: input.ctx.ip,
    userAgent: input.ctx.userAgent,
    metadata: {
      action: input.action,
      status: spec.to,
      previousStatus: spec.axis === 'verification'
        ? result.row.verification_status
        : result.row.user_status,
      previousState: result.previousState,
      providerId: result.row.id,
      reason: reason || null,
    },
  });

  return {
    id: result.row.id,
    verificationStatus: result.after.verification_status,
    accountStatus: result.after.user_status,
    state: effectiveState({
      verificationStatus: result.after.verification_status,
      accountStatus: result.after.user_status,
    }),
    previousState: result.previousState,
  };
}

/* ------------------------------- verification ------------------------------ */

async function applyVerification(
  c: Queryable,
  row: LockedProvider,
  to: string,
  reason: string,
): Promise<void> {
  // Re-entering the queue restarts the clock, so "oldest waiting" on the admin
  // queue reflects how long *this* case has been open. Asking for more
  // information keeps the original timestamp: it is still the same submission.
  const requestedAt =
    to === 'pending' ? 'now()'
      : to === 'info_requested' ? 'COALESCE(verification_requested_at, now())'
        : 'NULL';

  await c.query(
    `UPDATE providers SET
        verification_status = $2,
        verification_note   = $3,
        verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
        verification_requested_at = ${requestedAt},
        -- A rejection takes the listings down. Revoking a badge does not:
        -- losing a trust signal is not the same as losing the right to trade.
        is_published = CASE WHEN $2 = 'rejected' THEN false ELSE is_published END,
        updated_at = now()
      WHERE id = $1`,
    [row.id, to, reason || null],
  );
}

/* --------------------------------- account -------------------------------- */

async function applyAccount(
  c: Queryable,
  row: LockedProvider,
  to: string,
  reason: string,
): Promise<void> {
  await c.query(
    `UPDATE users SET status = $2, status_reason = $3, status_changed_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [row.user_id, to, reason || null],
  );

  if (to === 'suspended' || to === 'blocked') {
    await c.query('UPDATE providers SET is_published = false, updated_at = now() WHERE id = $1', [row.id]);
    return;
  }

  // Reinstating restores what was taken away. Leaving the provider unlisted
  // after "your account is active again" is the kind of half-reversal that
  // produces a support ticket a week later, when they notice no enquiries.
  const { rows } = await c.query<{ metadata: { wasPublished?: boolean } }>(
    `SELECT metadata FROM provider_status_events
      WHERE provider_id = $1 AND axis = 'account' AND action IN ('suspend','block')
      ORDER BY id DESC LIMIT 1`,
    [row.id],
  );
  const wasPublished = rows[0]?.metadata?.wasPublished === true;
  if (wasPublished) {
    await c.query('UPDATE providers SET is_published = true, updated_at = now() WHERE id = $1', [row.id]);
  }
}

/* ------------------------------ notifications ----------------------------- */

function notificationFor(action: ProviderAction, reason: string) {
  const fallback = 'Open your profile for the details.';
  switch (action) {
    case 'approve':
    case 'overturn':
      return {
        type: 'provider.verification_verified',
        title: 'Your business is verified',
        body: reason || 'The verified badge is now on your public profile.',
        data: {},
      };
    case 'request_info':
      return {
        type: 'provider.verification_info_requested',
        title: 'We need a bit more to finish your verification',
        body: reason || fallback,
        data: {},
      };
    case 'reject':
      return {
        type: 'provider.verification_rejected',
        title: 'Verification was not approved',
        body: reason || fallback,
        data: {},
      };
    case 'reopen':
      return {
        type: 'provider.verification_pending',
        title: 'Your verification is being reviewed again',
        body: reason || 'We have reopened your case.',
        data: {},
      };
    case 'revoke':
      return {
        type: 'provider.verification_revoked',
        title: 'Your verified badge has been removed',
        body: reason || fallback,
        data: {},
      };
    case 'suspend':
      return {
        type: 'account.suspended',
        title: 'Your account has been suspended',
        body: reason || fallback,
        data: {},
      };
    case 'block':
      return {
        type: 'account.blocked',
        title: 'Your account has been blocked',
        body: reason || fallback,
        data: {},
      };
    case 'reinstate':
    case 'unblock':
    default:
      return {
        type: 'account.reinstated',
        title: 'Your account is active again',
        body: reason || 'Welcome back.',
        data: {},
      };
  }
}
