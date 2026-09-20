import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, newIdempotencyKey } from '../../services/api';
import { qk, type JobFilters } from '../../services/queryKeys';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import type { CalendarJob, ClientDetail, ClientRow, JobDetail, JobRow } from '../../types/api';

/* --------------------------------- clients -------------------------------- */

export function useClients(q?: string) {
  return usePagedQuery<ClientRow>({
    queryKey: qk.clients.list(q),
    fetchPage: (cursor, signal) =>
      api.get('/provider/clients', { limit: 20, cursor, q: q || undefined }, signal),
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: qk.clients.detail(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<ClientDetail>(`/provider/clients/${id}`, undefined, signal),
  });
}

export interface ClientInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  tags?: string[];
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientInput) => api.post<{ id: string }>('/provider/clients', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clients.all });
    },
  });
}

export function useUpdateClient(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ClientInput>) =>
      api.patch<ClientDetail>(`/provider/clients/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.clients.all });
    },
  });
}

/* ---------------------------------- jobs ---------------------------------- */

export function useJobs(filters: JobFilters) {
  return usePagedQuery<JobRow>({
    queryKey: qk.jobs.list(filters),
    fetchPage: (cursor, signal) =>
      api.get('/provider/jobs', {
        limit: 20,
        cursor,
        status: filters.status,
        q: filters.q || undefined,
        clientId: filters.clientId,
      }, signal),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: qk.jobs.detail(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<JobDetail>(`/provider/jobs/${id}`, undefined, signal),
  });
}

export interface JobInput {
  clientId?: string;
  newClient?: ClientInput;
  serviceId?: string | null;
  title: string;
  description?: string | null;
  addressLine?: string | null;
  city?: string | null;
  /**
   * The state the work is in. Sales tax is sourced to where the job is, and
   * the invoice snapshots this as its jurisdiction — a city name alone does
   * not identify one.
   */
  region?: string | null;
  postalCode?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JobInput) =>
      api.post<{ id: string; reference: string }>('/provider/jobs', input, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.jobs.all });
      void queryClient.invalidateQueries({ queryKey: qk.clients.all });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

/**
 * Moves a job along the pipeline.
 *
 * The target comes from the job's own `allowedNextStatuses`; the server
 * rejects an illegal jump with a 409 and the list it would have accepted.
 * Nothing here decides what is legal.
 */
export function useAdvanceJob(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      status: string; note?: string; scheduledStart?: string | null; scheduledEnd?: string | null;
    }) => api.post<JobDetail>(`/provider/jobs/${jobId}/status`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.jobs.detail(jobId) });
      void queryClient.invalidateQueries({ queryKey: qk.jobs.all });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export function useAddJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; visibility: 'internal' | 'customer' }) =>
      api.post(`/provider/jobs/${jobId}/notes`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.jobs.detail(jobId) });
    },
  });
}

/* -------------------------------- calendar -------------------------------- */

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: qk.provider.calendar(from, to),
    queryFn: ({ signal }) =>
      api.get<{ data: CalendarJob[] }>('/provider/calendar', { from, to }, signal),
    select: (res) => res.data,
  });
}
