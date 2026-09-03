import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS, PROVIDER_TABS } from '../../components/nav';
import {
  Button, SkeletonList, ErrorState, Banner, Modal, TextField, SelectField,
} from '../../components/ui';
import { DocumentSheet, type DocumentLine } from './QuoteViewScreen';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/ui';
import { formatMoney, formatDate } from '../../lib/format';
import { printReceipt } from '../../lib/printReceipt';
import type { ReceiptData } from '../../components/Receipt';

/** What POST /invoices/:id/payments returns. */
interface PaymentResult {
  status: string;
  balanceCents: number;
  payment: { id: string; receiptNumber: string; amountCents: number; method: string; paidAt: string };
}

interface InvoiceDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxableBaseCents: number;
  untaxedBaseCents: number;
  taxJurisdiction: string | null;
  amountPaidCents: number;
  balanceCents: number;
  notes: string | null;
  sentAt: string | null;
  paidAt: string | null;
  pdfUrl: string | null;
  pdfSha256: string | null;
  job: { id: string; title: string } | null;
  provider: { businessName: string; tagline: string | null; city: string | null; phone: string | null };
  client: { fullName: string; email?: string; phone?: string; city: string | null };
  lines: DocumentLine[];
  payments: Array<{
    id?: string;
    receiptNumber?: string | null;
    receiptPrintedAt?: string | null;
    amountCents: number;
    status: string;
    method: string | null;
    paidAt: string | null;
  }>;
}

export function InvoiceViewScreen() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { notify } = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const invoice = useApi(() => api.get<InvoiceDetail>(`/invoices/${id}`), [id]);
  const tabs = user?.role === 'provider' ? PROVIDER_TABS : CUSTOMER_TABS;

  if (invoice.loading) {
    return <Shell title="Invoice" tabs={tabs} back><SkeletonList rows={3} /></Shell>;
  }
  if (invoice.error || !invoice.data) {
    return (
      <Shell title="Invoice" tabs={tabs} back>
        <ErrorState message={invoice.error ?? 'Invoice not found.'} onRetry={invoice.reload} />
      </Shell>
    );
  }

  const inv = invoice.data;
  const isProvider = user?.role === 'provider';
  const canSend = isProvider && inv.status === 'draft';
  const canRecordPayment = isProvider && ['sent', 'partially_paid', 'overdue'].includes(inv.status);

  /** Reprints an existing receipt. Reprinting reissues nothing: same number, same figures. */
  const reprint = async (paymentId: string) => {
    try {
      const receipt = await api.get<ReceiptData>(
        `/invoices/${inv.id}/receipts/${paymentId}`,
      );
      await printReceipt(receipt);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'We could not print that receipt.', 'error');
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${inv.id}/send`, {}, newIdempotencyKey());
      notify('Invoice sent.', 'success');
      invoice.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'We could not send it.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={inv.number} tabs={tabs} back>
      <DocumentSheet
        kind="Invoice"
        number={inv.number}
        status={inv.status}
        partyLabel={isProvider ? 'Bill to' : 'From'}
        partyName={isProvider ? inv.client.fullName : inv.provider.businessName}
        partyMeta={isProvider ? inv.client.city : inv.provider.city}
        dateLabel="Issued"
        dateValue={inv.issueDate}
        secondaryDateLabel={inv.dueDate ? 'Due' : undefined}
        secondaryDateValue={inv.dueDate}
        lines={inv.lines}
        currency={inv.currency}
        subtotalCents={inv.subtotalCents}
        discountCents={inv.discountCents}
        taxCents={inv.taxCents}
        totalCents={inv.totalCents}
        taxableBaseCents={inv.taxableBaseCents}
        untaxedBaseCents={inv.untaxedBaseCents}
        taxJurisdiction={inv.taxJurisdiction}
        amountPaidCents={inv.amountPaidCents}
        notes={inv.notes}
        pdfUrl={inv.pdfUrl}
        pdfSha256={inv.pdfSha256}
      />

      {inv.status === 'paid' && (
        <div className="mt-4">
          <Banner tone="success" icon="check">Paid in full on {formatDate(inv.paidAt)}.</Banner>
        </div>
      )}
      {inv.status === 'overdue' && (
        <div className="mt-4">
          <Banner tone="danger">
            This invoice is past its due date. Outstanding balance {formatMoney(inv.balanceCents, inv.currency)}.
          </Banner>
        </div>
      )}

      {inv.payments.length > 0 && (
        <section className="section mt-5">
          <h3 className="section__title mb-3">Payments</h3>
          <div className="list-group">
            {inv.payments.map((payment, index) => (
              <div key={payment.id ?? index} className="list-item" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="strong small tabular">{formatMoney(payment.amountCents, inv.currency)}</div>
                  <div className="tiny subtle">
                    {payment.method ?? 'Payment'} · {formatDate(payment.paidAt)}
                    {payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}
                  </div>
                </div>
                {/* Only the provider holds the printer, and only a payment that
                    was issued a receipt number has one to reprint. */}
                {isProvider && payment.id && payment.receiptNumber && (
                  <button
                    type="button"
                    className="section__link"
                    onClick={() => reprint(payment.id!)}
                  >
                    {payment.receiptPrintedAt ? 'Reprint' : 'Print'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(canSend || canRecordPayment) && (
        <div className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s5)' }}>
          {canSend && <Button block icon="check" onClick={send} loading={busy}>Send invoice</Button>}
          {canRecordPayment && (
            <Button block variant="secondary" onClick={() => setPayOpen(true)}>Record payment</Button>
          )}
        </div>
      )}

      <RecordPaymentModal
        open={payOpen}
        invoiceId={inv.id}
        balanceCents={inv.balanceCents}
        currency={inv.currency}
        onClose={() => setPayOpen(false)}
        onDone={() => {
          setPayOpen(false);
          notify('Payment recorded.', 'success');
          invoice.reload();
        }}
      />
    </Shell>
  );
}

function RecordPaymentModal({
  open, invoiceId, balanceCents, currency, onClose, onDone,
}: {
  open: boolean; invoiceId: string; balanceCents: number; currency: string;
  onClose: () => void; onDone: () => void;
}) {
  const { notify } = useToast();
  const [amount, setAmount] = useState((balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState('transfer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<PaymentResult>(
        `/invoices/${invoiceId}/payments`,
        { amountCents: cents, method },
        newIdempotencyKey(),
      );

      /**
       * The payment is committed at this point. Printing is a side effect of a
       * completed sale, never a step of it — so it runs after, in its own
       * try/catch, and a printer that is off, out of paper or simply not there
       * cannot turn a recorded payment into an error the operator has to
       * interpret at the till.
       */
      try {
        const receipt = await api.get<ReceiptData>(
          `/invoices/${invoiceId}/receipts/${result.payment.id}`,
        );
        await printReceipt(receipt);
        // Best effort: whether the slip reached paper does not change the money.
        api.post(`/invoices/${invoiceId}/receipts/${result.payment.id}/printed`, {})
          .catch(() => {});
      } catch {
        notify(
          `Payment saved as ${result.payment.receiptNumber}, but the receipt did not print. ` +
          'You can reprint it from the payment list.',
          'error',
        );
      }

      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not record that payment.');
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Record a payment" onClose={onClose}>
      <p className="modal__body">
        Outstanding balance: <strong>{formatMoney(balanceCents, currency)}</strong>
      </p>

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      <TextField
        label="Amount"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <SelectField
        label="Method"
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        options={[
          { value: 'transfer', label: 'Bank transfer' },
          { value: 'cash', label: 'Cash' },
          { value: 'card', label: 'Card' },
          { value: 'other', label: 'Other' },
        ]}
      />

      <div className="modal__actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy}>Record payment</Button>
      </div>
    </Modal>
  );
}
