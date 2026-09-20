import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, newIdempotencyKey } from '../../services/api';
import { qk } from '../../services/queryKeys';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import type { LineInput, QuoteDetail, QuoteRow } from '../../types/api';

export function useQuotes(status?: string) {
  return usePagedQuery<QuoteRow>({
    queryKey: qk.quotes.list(status),
    fetchPage: (cursor, signal) => api.get('/quotes', { limit: 20, cursor, status }, signal),
  });
}

export function useQuote(id: string) {
  return useQuery({
    queryKey: qk.quotes.detail(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<QuoteDetail>(`/quotes/${id}`, undefined, signal),
  });
}

export interface QuoteInput {
  jobId: string;
  lines: LineInput[];
  discountCents?: number;
  currency?: string;
  validUntil?: string | null;
  notes?: string | null;
  terms?: string | null;
}

/**
 * Creates a draft quote.
 *
 * Totals are not sent: the server computes them from the line items, and its
 * numbers are the ones stored, printed and emailed. The builder's running
 * total is a preview of that calculation, never an input to it.
 */
export function useCreateQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QuoteInput) =>
      api.post<{ id: string; number: string }>('/quotes', input, newIdempotencyKey()),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: qk.quotes.all });
      void queryClient.invalidateQueries({ queryKey: qk.jobs.detail(input.jobId) });
      void queryClient.invalidateQueries({ queryKey: qk.jobs.all });
    },
  });
}

export function useUpdateQuote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Drafts only — the server refuses once a quote has been sent, because the
    // customer is looking at a document that must not change under them.
    mutationFn: (input: Partial<QuoteInput>) => api.patch<QuoteDetail>(`/quotes/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.quotes.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.quotes.all });
    },
  });
}

export function useSendQuote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<QuoteDetail>(`/quotes/${id}/send`, {}, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.quotes.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.quotes.all });
      void queryClient.invalidateQueries({ queryKey: qk.jobs.all });
    },
  });
}

/** The customer's side: accept or decline a quote they have been sent. */
export function useRespondToQuote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: 'accept' | 'decline') =>
      api.post<QuoteDetail>(`/quotes/${id}/respond`, { decision }, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.quotes.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.customer.requests });
      void queryClient.invalidateQueries({ queryKey: qk.customer.home });
    },
  });
}
