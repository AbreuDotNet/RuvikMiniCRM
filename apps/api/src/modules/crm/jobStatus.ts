export const JOB_STATUSES = [
  'new_lead', 'contacted', 'quoted', 'approved',
  'scheduled', 'in_progress', 'completed', 'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Allowed pipeline transitions. Encoded here rather than left to the UI so
 * that an API client cannot jump a job straight to `completed` (which would
 * unlock reviewing and invoicing) without passing through the real workflow.
 */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  new_lead:    ['contacted', 'quoted', 'cancelled'],
  contacted:   ['quoted', 'approved', 'scheduled', 'cancelled'],
  quoted:      ['approved', 'contacted', 'cancelled'],
  approved:    ['scheduled', 'in_progress', 'cancelled'],
  scheduled:   ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [],
  cancelled:   [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNext(from: JobStatus): JobStatus[] {
  return TRANSITIONS[from] ?? [];
}

export const TERMINAL_STATUSES: JobStatus[] = ['completed', 'cancelled'];
