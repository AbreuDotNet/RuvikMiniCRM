import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, newIdempotencyKey } from '../../services/api';
import { qk } from '../../services/queryKeys';
import type {
  InvoiceDetail, InvoiceList, InvoiceRow, LineInput, PaymentResult, QuoteRow,
} from '../../types/api';

/**
 * The invoice list, with the server's outstanding/collected summary.
 *
 * Not paged through `usePagedQuery`: the summary lives beside `data` rather
 * than inside it, and flattening pages would quietly drop it.
 */
export function useInvoices(status?: string) {
  return useQuery({
    queryKey: qk.invoices.list(status),
    queryFn: ({ signal }) =>
      api.get<InvoiceList>('/invoices', { limit: 30, status }, signal),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: qk.invoices.detail(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<InvoiceDetail>(`/invoices/${id}`, undefined, signal),
  });
}

/** Accepted quotes that have not been invoiced yet, for the create flow. */
export function useInvoiceableQuotes() {
  return useQuery({
    queryKey: qk.quotes.list('accepted'),
    queryFn: ({ signal }) =>
      api.get<{ data: QuoteRow[] }>('/quotes', { status: 'accepted', limit: 50 }, signal),
    // The server refuses a second invoice for the same quote, so offering one
    // that already has a live invoice would only produce a 409.
    select: (res) => res.data.filter((quote) => quote.invoice === null),
  });
}

export interface InvoiceInput {
  jobId?: string;
  clientId?: string;
  fromQuoteId?: string;
  lines?: LineInput[];
  discountCents?: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string | null;
  notes?: string | null;
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InvoiceInput) =>
      api.post<InvoiceRow & { id: string; number: string }>('/invoices', input, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invoices.all });
      void queryClient.invalidateQueries({ queryKey: qk.quotes.all });
      void queryClient.invalidateQueries({ queryKey: qk.jobs.all });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export function useSendInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<InvoiceDetail>(`/invoices/${id}/send`, {}, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invoices.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.invoices.all });
    },
  });
}

/**
 * Records a payment already received — cash, a transfer, a card taken
 * elsewhere. Ruvik does not move the money; it records that it moved.
 *
 * The idempotency key is minted by the caller when the button is pressed and
 * held across retries, so a dropped response cannot book the amount twice.
 */
export function useRecordPayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      amountCents, method, reference, idempotencyKey,
    }: {
      amountCents: number;
      method: 'cash' | 'card' | 'transfer' | 'manual' | 'other';
      reference?: string;
      idempotencyKey: string;
    }) => api.post<PaymentResult>(
      `/invoices/${id}/payments`, { amountCents, method, reference }, idempotencyKey,
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invoices.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.invoices.all });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export function useVoidInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<InvoiceDetail>(`/invoices/${id}/void`, { reason }, newIdempotencyKey()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invoices.detail(id) });
      void queryClient.invalidateQueries({ queryKey: qk.invoices.all });
      void queryClient.invalidateQueries({ queryKey: qk.provider.dashboard });
    },
  });
}

export interface ReceiptData {
  receiptNumber: string;
  amountCents: number;
  currency: string;
  method: string | null;
  paidAt: string | null;
  balanceCents: number;
  invoice: { id: string; number: string; totalCents: number };
  provider: { businessName: string; phone: string | null; city: string | null };
  client: { fullName: string };
}

/**
 * Re-reads a receipt, balance and all, as it stood when the payment landed.
 *
 * Fetched on demand rather than cached with the invoice: a receipt is a
 * record of a moment, and re-deriving it from today's balance would print a
 * different document than the one the customer was handed.
 */
export function usePaymentReceipt(invoiceId: string, paymentId: string | null) {
  return useQuery({
    queryKey: ['invoices', invoiceId, 'receipt', paymentId],
    enabled: Boolean(invoiceId && paymentId),
    queryFn: ({ signal }) =>
      api.get<ReceiptData>(`/invoices/${invoiceId}/receipts/${paymentId}`, undefined, signal),
  });
}
