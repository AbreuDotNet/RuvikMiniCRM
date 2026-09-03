/**
 * Provider lifecycle: the single definition of which admin actions exist and
 * when they are legal.
 *
 * ## Two axes, one derived state
 *
 * Verification ("did we check their documents?") and account status ("may they
 * operate right now?") are independent. A verified provider who is suspended
 * and later reinstated returns to verified, because suspension never touched
 * the verification axis. The admin, however, thinks in one status — so the two
 * are collapsed into an *effective state* for display and for deciding which
 * actions to offer.
 *
 * ## Why the table rather than ad-hoc `if`s
 *
 * The API enforces these transitions and the UI renders buttons from the same
 * table (mirrored in `apps/web/src/lib/providerLifecycle.ts`, guarded by a
 * parity test). Anything else lets the interface offer a button that the
 * server will refuse, which is the specific failure this replaces: the old
 * modal showed "Approve verification" on providers that were already verified.
 */

export const VERIFICATION_STATUSES = [
  'unverified', 'pending', 'info_requested', 'verified', 'rejected',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ACCOUNT_STATUSES = [
  'active', 'suspended', 'blocked', 'pending_deletion', 'deleted',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const EFFECTIVE_STATES = [
  'unverified', 'pending', 'info_requested', 'verified', 'rejected',
  'suspended', 'blocked', 'closed',
] as const;
export type EffectiveState = (typeof EFFECTIVE_STATES)[number];

export const PROVIDER_ACTIONS = [
  'approve', 'request_info', 'reject', 'reopen', 'overturn', 'revoke',
  'suspend', 'reinstate', 'block', 'unblock',
] as const;
export type ProviderAction = (typeof PROVIDER_ACTIONS)[number];

export type ActionAxis = 'verification' | 'account';

export interface ActionSpec {
  action: ProviderAction;
  axis: ActionAxis;
  /** Status this action writes to its own axis. The other axis is untouched. */
  to: VerificationStatus | AccountStatus;
  /** Effective states the action may be invoked from. */
  from: readonly EffectiveState[];
  label: string;
  /** One line under the button saying what actually happens. */
  description: string;
  tone: 'primary' | 'secondary' | 'danger';
  /** A reason is stored in the history and, where relevant, shown to the provider. */
  requiresReason: boolean;
  /** Second deliberate step before anything irreversible or externally visible. */
  requiresConfirmation: boolean;
  /** Body of the confirmation dialog. Present iff requiresConfirmation. */
  confirmBody?: string;
  /** State-changing admin routes are gated on an MFA-elevated session. */
  requiresMfa: boolean;
}

/**
 * Shortest reason we accept. "ok" and "." are not reasons, and this text is
 * read months later by someone reconstructing a decision.
 */
export const MIN_REASON_LENGTH = 10;

const DECIDABLE = ['unverified', 'pending', 'info_requested'] as const;
const OPERATING = [
  'unverified', 'pending', 'info_requested', 'verified', 'rejected',
] as const;

export const ACTION_SPECS: readonly ActionSpec[] = [
  {
    action: 'approve',
    axis: 'verification',
    to: 'verified',
    // Not reachable from 'rejected': reversing a rejection is 'overturn',
    // which demands a written reason. Approval itself never needs one.
    from: DECIDABLE,
    label: 'Approve verification',
    description: 'Publishes the verified badge on their public profile.',
    tone: 'primary',
    requiresReason: false,
    requiresConfirmation: false,
    requiresMfa: true,
  },
  {
    action: 'request_info',
    axis: 'verification',
    to: 'info_requested',
    from: ['unverified', 'pending'],
    label: 'Request more information',
    description: 'Sends your note to the provider and leaves the case open.',
    tone: 'secondary',
    requiresReason: true,
    requiresConfirmation: false,
    requiresMfa: true,
  },
  {
    action: 'reject',
    axis: 'verification',
    to: 'rejected',
    // Reachable from 'verified' as well: a licence that turns out to be
    // forged is a rejection, not a revocation back into the queue. It is a
    // verification reversal, so it demands a reason like every other one.
    from: [...DECIDABLE, 'verified'],
    label: 'Reject verification',
    description: 'Turns them down and hides their listings.',
    tone: 'danger',
    requiresReason: true,
    requiresConfirmation: true,
    confirmBody:
      'The provider is unlisted from search and told the reason you wrote. '
      + 'Reopening the review later is possible but starts the case again. To '
      + 'ask for a re-check without turning them down, revoke instead.',
    requiresMfa: true,
  },
  {
    action: 'reopen',
    axis: 'verification',
    to: 'pending',
    // Also legal from 'unverified': an admin who has been handed documents
    // out of band can put a provider into the queue on their behalf, which
    // the status-based endpoint has always allowed.
    from: ['unverified', 'rejected', 'info_requested'],
    label: 'Send to the review queue',
    description: 'Puts the case in the pending queue for a decision.',
    tone: 'secondary',
    requiresReason: false,
    requiresConfirmation: false,
    requiresMfa: true,
  },
  {
    action: 'overturn',
    axis: 'verification',
    to: 'verified',
    from: ['rejected'],
    label: 'Overturn rejection and verify',
    description: 'Reverses an earlier rejection. Records why it was wrong.',
    tone: 'secondary',
    requiresReason: true,
    requiresConfirmation: true,
    confirmBody:
      'This reverses a decision another admin may have made. The rejection and '
      + 'your reason both stay in the provider history.',
    requiresMfa: true,
  },
  {
    action: 'revoke',
    axis: 'verification',
    to: 'pending',
    from: ['verified'],
    label: 'Revoke verification',
    description: 'Removes the badge and returns the case to the pending queue.',
    tone: 'danger',
    requiresReason: true,
    requiresConfirmation: true,
    confirmBody:
      'The verified badge disappears from their public profile immediately and '
      + 'the case goes back into the review queue. Their listings stay online.',
    requiresMfa: true,
  },
  {
    action: 'suspend',
    axis: 'account',
    to: 'suspended',
    from: OPERATING,
    label: 'Suspend account',
    description: 'Temporary. Signs them out everywhere and hides their listings.',
    tone: 'danger',
    requiresConfirmation: true,
    requiresReason: true,
    confirmBody:
      'Every session ends immediately and their listings come down. Verification '
      + 'is preserved, so reinstating restores exactly what they had.',
    requiresMfa: true,
  },
  {
    action: 'reinstate',
    axis: 'account',
    to: 'active',
    from: ['suspended'],
    label: 'Reinstate account',
    description: 'Restores their previous verification and listing visibility.',
    tone: 'primary',
    requiresReason: true,
    requiresConfirmation: false,
    requiresMfa: true,
  },
  {
    action: 'block',
    axis: 'account',
    to: 'blocked',
    from: [...OPERATING, 'suspended'],
    label: 'Block permanently',
    description: 'Terminal. They cannot sign in again until an admin unblocks them.',
    tone: 'danger',
    requiresReason: true,
    requiresConfirmation: true,
    confirmBody:
      'This is the strongest action available. Sign-in is refused, sessions end '
      + 'and listings come down. Use suspension for anything you expect to undo.',
    requiresMfa: true,
  },
  {
    action: 'unblock',
    axis: 'account',
    to: 'active',
    from: ['blocked'],
    label: 'Unblock account',
    description: 'Restores access. The block stays in the history.',
    tone: 'secondary',
    requiresReason: true,
    requiresConfirmation: true,
    confirmBody:
      'Reversing a permanent block. The original block and your reason both stay '
      + 'in the provider history.',
    requiresMfa: true,
  },
];

const BY_ACTION = new Map<ProviderAction, ActionSpec>(
  ACTION_SPECS.map((spec) => [spec.action, spec]),
);

/**
 * Collapses the two axes into the one status an admin reasons about.
 * Account state wins: whether someone may operate matters more than whether
 * we checked their paperwork.
 */
export function effectiveState(input: {
  verificationStatus: string;
  accountStatus: string;
}): EffectiveState {
  switch (input.accountStatus) {
    case 'blocked': return 'blocked';
    case 'suspended': return 'suspended';
    case 'pending_deletion':
    case 'deleted': return 'closed';
    default: break;
  }
  return (VERIFICATION_STATUSES as readonly string[]).includes(input.verificationStatus)
    ? (input.verificationStatus as EffectiveState)
    : 'unverified';
}

export function actionSpec(action: string): ActionSpec | undefined {
  return BY_ACTION.get(action as ProviderAction);
}

/** Every action legal from this state, in the order they should be shown. */
export function allowedActions(state: EffectiveState): ActionSpec[] {
  return ACTION_SPECS.filter((spec) => spec.from.includes(state));
}

export function isAllowed(state: EffectiveState, action: string): boolean {
  const spec = BY_ACTION.get(action as ProviderAction);
  return Boolean(spec && spec.from.includes(state));
}

/* --------------------------------- labels --------------------------------- */

export const STATE_LABELS: Record<EffectiveState, string> = {
  unverified: 'Not submitted',
  pending: 'Pending review',
  info_requested: 'Information requested',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
  blocked: 'Blocked',
  closed: 'Closed',
};

/** What the state means for the provider right now, in one line. */
export const STATE_MEANING: Record<EffectiveState, string> = {
  unverified: 'They have not submitted anything for review yet.',
  pending: 'Waiting on your decision.',
  info_requested: 'Waiting on the provider to send what you asked for.',
  verified: 'Checked and trading with the verified badge.',
  rejected: 'Turned down. Their listings are hidden.',
  suspended: 'Temporarily stopped. Verification is preserved.',
  blocked: 'Permanently barred from signing in.',
  closed: 'The account is being deleted. Nothing can be changed.',
};

/**
 * Deliberately reuses the platform-wide pill tones rather than inventing a
 * palette: an admin reading "Verified" green here and a different green on the
 * provider list would have to learn two systems.
 */
export const STATE_TONES: Record<EffectiveState, 'success' | 'warning' | 'danger' | 'neutral' | 'accent'> = {
  unverified: 'neutral',
  pending: 'warning',
  info_requested: 'accent',
  verified: 'success',
  rejected: 'danger',
  suspended: 'danger',
  blocked: 'danger',
  closed: 'neutral',
};

/**
 * States that mean somebody has to do something. Drives both the Overview
 * counters and the default filter on the provider queue.
 */
export const NEEDS_ATTENTION: readonly EffectiveState[] = ['pending', 'info_requested'];

/* ------------------------------ legacy bridge ----------------------------- */

/**
 * The original endpoint took a raw target status. Callers that predate the
 * action vocabulary keep working: the status is mapped to the action that
 * reaches it from wherever the provider currently is.
 */
export function actionForLegacyStatus(
  state: EffectiveState,
  status: string,
): ProviderAction | undefined {
  const candidate = ((): ProviderAction | undefined => {
    switch (status) {
      case 'verified':
        // Reversing a rejection is its own action because it needs a reason,
        // so a legacy caller asking for 'verified' is routed to whichever of
        // the two is legal from where the provider stands.
        return state === 'rejected' ? 'overturn' : 'approve';
      case 'rejected': return 'reject';
      case 'info_requested': return 'request_info';
      case 'pending':
      case 'unverified':
        return state === 'verified' ? 'revoke' : 'reopen';
      default: return undefined;
    }
  })();

  // The bridge never widens what the machine allows. A status that has no
  // legal action from here returns nothing, and the endpoint answers with a
  // 400 naming the status rather than a transition nobody intended.
  return candidate && isAllowed(state, candidate) ? candidate : undefined;
}
