import { describe, it, expect } from 'vitest';
import {
  ACTION_SPECS, EFFECTIVE_STATES, PROVIDER_ACTIONS, MIN_REASON_LENGTH,
  STATE_LABELS, STATE_MEANING, STATE_TONES,
  effectiveState, allowedActions, isAllowed, actionSpec, actionForLegacyStatus,
  type EffectiveState,
} from '../../src/lib/providerLifecycle.js';
// The admin UI renders its buttons from the web mirror while the API enforces
// this one. Imported from the other workspace so the two cannot drift apart:
// if they do, the interface offers a button the server refuses.
import * as web from '../../../web/src/lib/providerLifecycle.js';

describe('effective state', () => {
  it('lets account status win over verification', () => {
    expect(effectiveState({ verificationStatus: 'verified', accountStatus: 'blocked' }))
      .toBe('blocked');
    expect(effectiveState({ verificationStatus: 'verified', accountStatus: 'suspended' }))
      .toBe('suspended');
  });

  it('reports the verification status while the account is active', () => {
    for (const v of ['unverified', 'pending', 'info_requested', 'verified', 'rejected']) {
      expect(effectiveState({ verificationStatus: v, accountStatus: 'active' })).toBe(v);
    }
  });

  it('treats a deleted or closing account as read-only', () => {
    expect(effectiveState({ verificationStatus: 'verified', accountStatus: 'pending_deletion' }))
      .toBe('closed');
    expect(effectiveState({ verificationStatus: 'verified', accountStatus: 'deleted' }))
      .toBe('closed');
  });

  it('falls back to unverified rather than inventing a state', () => {
    expect(effectiveState({ verificationStatus: 'nonsense', accountStatus: 'active' }))
      .toBe('unverified');
  });
});

describe('action availability', () => {
  it('never offers approval to a provider that is already verified', () => {
    const actions = allowedActions('verified').map((a) => a.action);
    expect(actions).not.toContain('approve');
    expect(actions).not.toContain('overturn');
    // This is the whole point of the rework: the old modal showed
    // "Approve verification" on every provider regardless of state.
  });

  it('offers exactly the reversals a verified provider allows', () => {
    // revoke sends the case back to the queue and keeps them trading;
    // reject turns them down outright. Both are reversals and both demand a
    // reason. suspend and block act on the account rather than the badge.
    expect(allowedActions('verified').map((a) => a.action).sort())
      .toEqual(['block', 'reject', 'revoke', 'suspend']);
  });

  it('offers a decision, a question and a stop on a pending provider', () => {
    const actions = allowedActions('pending').map((a) => a.action);
    expect(actions).toContain('approve');
    expect(actions).toContain('reject');
    expect(actions).toContain('request_info');
  });

  it('offers only reactivation paths on a blocked provider', () => {
    expect(allowedActions('blocked').map((a) => a.action)).toEqual(['unblock']);
  });

  it('offers nothing at all on a closed account', () => {
    expect(allowedActions('closed')).toEqual([]);
  });

  it('does not offer suspension to an account that is already suspended', () => {
    expect(isAllowed('suspended', 'suspend')).toBe(false);
    expect(isAllowed('suspended', 'reinstate')).toBe(true);
    expect(isAllowed('suspended', 'block')).toBe(true);
  });

  it('does not offer reinstatement to an account that is not stopped', () => {
    expect(isAllowed('verified', 'reinstate')).toBe(false);
    expect(isAllowed('pending', 'unblock')).toBe(false);
  });

  it('rejects an unknown action', () => {
    expect(isAllowed('pending', 'delete_everything')).toBe(false);
    expect(actionSpec('delete_everything')).toBeUndefined();
  });
});

describe('safety rules', () => {
  it('demands a reason for everything that stops or reverses an account', () => {
    const mustExplain = ['reject', 'revoke', 'overturn', 'suspend', 'block', 'unblock', 'reinstate'];
    for (const action of mustExplain) {
      expect(actionSpec(action)?.requiresReason, action).toBe(true);
    }
  });

  it('asks for a second confirmation before anything hard to walk back', () => {
    for (const action of ['reject', 'revoke', 'suspend', 'block', 'unblock', 'overturn']) {
      const spec = actionSpec(action)!;
      expect(spec.requiresConfirmation, action).toBe(true);
      // A confirmation dialog with no body is a speed bump, not a warning.
      expect(spec.confirmBody, action).toBeTruthy();
    }
  });

  it('does not put a confirmation in front of approving or asking a question', () => {
    expect(actionSpec('approve')!.requiresConfirmation).toBe(false);
    expect(actionSpec('request_info')!.requiresConfirmation).toBe(false);
    expect(actionSpec('reopen')!.requiresConfirmation).toBe(false);
  });

  it('gates every action on a two-factor session', () => {
    for (const spec of ACTION_SPECS) expect(spec.requiresMfa, spec.action).toBe(true);
  });

  it('gives every confirmable action a body long enough to be read', () => {
    for (const spec of ACTION_SPECS) {
      if (!spec.requiresConfirmation) continue;
      expect(spec.confirmBody!.length, spec.action).toBeGreaterThan(40);
    }
  });
});

describe('table integrity', () => {
  it('defines every declared action exactly once', () => {
    expect(ACTION_SPECS.map((s) => s.action).sort()).toEqual([...PROVIDER_ACTIONS].sort());
  });

  it('only ever names states that exist', () => {
    for (const spec of ACTION_SPECS) {
      for (const from of spec.from) {
        expect(EFFECTIVE_STATES, `${spec.action} from`).toContain(from);
      }
    }
  });

  it('labels and explains every state', () => {
    for (const state of EFFECTIVE_STATES) {
      expect(STATE_LABELS[state], state).toBeTruthy();
      expect(STATE_MEANING[state], state).toBeTruthy();
      expect(STATE_TONES[state], state).toBeTruthy();
    }
  });

  it('leaves no state stranded — every non-closed state has a way out', () => {
    for (const state of EFFECTIVE_STATES) {
      if (state === 'closed') continue;
      expect(allowedActions(state as EffectiveState).length, state).toBeGreaterThan(0);
    }
  });

  it('can reach verified from every state a live account can be in', () => {
    // Not necessarily in one step: rejected goes through overturn, blocked
    // through unblock. What matters is that no state is a dead end.
    const reachable = (start: EffectiveState, seen = new Set<string>()): boolean => {
      if (start === 'verified') return true;
      if (seen.has(start)) return false;
      seen.add(start);
      return allowedActions(start).some((spec) => {
        const next = spec.axis === 'verification'
          ? (spec.to as EffectiveState)
          // Returning to an active account lands back on the verification axis;
          // the worst case is 'unverified', so use that as the conservative step.
          : spec.to === 'active' ? 'unverified' : (spec.to as EffectiveState);
        return reachable(next, seen);
      });
    };

    for (const state of EFFECTIVE_STATES) {
      if (state === 'closed') continue;
      expect(reachable(state as EffectiveState), state).toBe(true);
    }
  });
});

describe('legacy status bridge', () => {
  it('maps a target status to an action legal from the current state', () => {
    expect(actionForLegacyStatus('unverified', 'verified')).toBe('approve');
    expect(actionForLegacyStatus('pending', 'verified')).toBe('approve');
    // Reversing a rejection is its own action because it demands a reason.
    expect(actionForLegacyStatus('rejected', 'verified')).toBe('overturn');
    expect(actionForLegacyStatus('verified', 'pending')).toBe('revoke');
    expect(actionForLegacyStatus('rejected', 'pending')).toBe('reopen');
  });

  it('never returns an action the machine would refuse', () => {
    const states = ['unverified', 'pending', 'info_requested', 'verified', 'rejected'] as const;
    for (const state of states) {
      for (const status of ['verified', 'rejected', 'pending', 'info_requested', 'unverified']) {
        const action = actionForLegacyStatus(state, status);
        if (!action) continue;
        expect(isAllowed(state, action), `${state} -> ${status} (${action})`).toBe(true);
      }
    }
  });

  it('declines a transition that has no legal action rather than inventing one', () => {
    // A verified provider cannot be pushed into "waiting on the provider":
    // the badge would come off with no decision recorded. Revoke, then ask.
    expect(actionForLegacyStatus('verified', 'info_requested')).toBeUndefined();
    // Nor can a pending provider be "reopened" — it is already open.
    expect(actionForLegacyStatus('pending', 'pending')).toBeUndefined();
  });

  it('refuses a status it has no mapping for', () => {
    expect(actionForLegacyStatus('pending', 'exploded')).toBeUndefined();
  });
});

describe('parity with the admin UI copy of this table', () => {
  it('has identical action specs', () => {
    expect(web.ACTION_SPECS).toEqual(ACTION_SPECS);
  });

  it('has identical states, actions and labels', () => {
    expect(web.EFFECTIVE_STATES).toEqual(EFFECTIVE_STATES);
    expect(web.PROVIDER_ACTIONS).toEqual(PROVIDER_ACTIONS);
    expect(web.STATE_LABELS).toEqual(STATE_LABELS);
    expect(web.STATE_MEANING).toEqual(STATE_MEANING);
    expect(web.STATE_TONES).toEqual(STATE_TONES);
    expect(web.MIN_REASON_LENGTH).toBe(MIN_REASON_LENGTH);
  });

  it('agrees on the effective state for every combination', () => {
    const verifications = ['unverified', 'pending', 'info_requested', 'verified', 'rejected'];
    const accounts = ['active', 'suspended', 'blocked', 'pending_deletion', 'deleted'];
    for (const v of verifications) {
      for (const a of accounts) {
        expect(web.effectiveState({ verificationStatus: v, accountStatus: a }))
          .toBe(effectiveState({ verificationStatus: v, accountStatus: a }));
      }
    }
  });

  it('agrees on which actions are available from every state', () => {
    for (const state of EFFECTIVE_STATES) {
      expect(web.allowedActions(state).map((s) => s.action))
        .toEqual(allowedActions(state).map((s) => s.action));
    }
  });
});
