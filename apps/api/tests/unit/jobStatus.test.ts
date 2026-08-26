import { describe, it, expect } from 'vitest';
import { canTransition, allowedNext, JOB_STATUSES } from '../../src/modules/crm/jobStatus.js';

describe('job pipeline transitions', () => {
  it('walks the happy path from lead to completion', () => {
    expect(canTransition('new_lead', 'contacted')).toBe(true);
    expect(canTransition('contacted', 'quoted')).toBe(true);
    expect(canTransition('quoted', 'approved')).toBe(true);
    expect(canTransition('approved', 'scheduled')).toBe(true);
    expect(canTransition('scheduled', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });

  it('refuses to jump straight from a new lead to completed', () => {
    // Completion unlocks reviewing and invoicing, so it must be earned.
    expect(canTransition('new_lead', 'completed')).toBe(false);
  });

  it('treats completed and cancelled as terminal', () => {
    expect(allowedNext('completed')).toEqual([]);
    expect(allowedNext('cancelled')).toEqual([]);
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('cancelled', 'new_lead')).toBe(false);
  });

  it('allows cancellation from every non-terminal state', () => {
    for (const status of JOB_STATUSES) {
      if (status === 'completed' || status === 'cancelled') continue;
      expect(canTransition(status, 'cancelled')).toBe(true);
    }
  });

  it('rejects an unknown target status', () => {
    expect(canTransition('new_lead', 'nonsense' as never)).toBe(false);
  });
});
