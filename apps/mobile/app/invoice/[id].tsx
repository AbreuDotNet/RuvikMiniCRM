import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { RequireSession } from '../../src/components/Guard';
import { DocumentLines, DocumentTotals } from '../../src/components/DocumentView';
import {
  Badge, Banner, Button, Card, ConfirmSheet, DetailRow, Divider, ErrorState,
  Input, ListRow, ScreenScroll, SectionHeader, Segmented, Sheet, SkeletonList,
  Stack, Text, useFeedback,
} from '../../src/components/ui';
import {
  useInvoice, useRecordPayment, useSendInvoice, useVoidInvoice,
} from '../../src/features/invoices/hooks';
import { shareDocument } from '../../src/services/files';
import { errorMessage, newIdempotencyKey } from '../../src/services/api';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatDateTime, formatMoney } from '../../src/utils/format';
import { invoiceStatus } from '../../src/utils/status';
import { centsToInput, parseAmountToCents } from '../../src/utils/moneyInput';

export default function InvoiceRoute() {
  return (
    <RequireSession>
      <InvoiceDetailScreen />
    </RequireSession>
  );
}

function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = id ?? '';
  const { user } = useAuth();
  const { notify } = useFeedback();

  const invoice = useInvoice(invoiceId);
  const send = useSendInvoice(invoiceId);
  const voidInvoice = useVoidInvoice(invoiceId);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [sharing, setSharing] = useState(false);

  if (invoice.isPending) {
    return <ScreenScroll><SkeletonList rows={4} /></ScreenScroll>;
  }
  if (invoice.isError || !invoice.data) {
    return (
      <ScreenScroll>
        <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
      </ScreenScroll>
    );
  }

  const inv = invoice.data;
  const look = invoiceStatus(inv.status);
  const isProvider = user?.role === 'provider';
  const settled = inv.balanceCents <= 0;
  const voided = inv.status === 'void';

  const share = async () => {
    if (!inv.pdfUrl) return;
    setSharing(true);
    try {
      await shareDocument(inv.pdfUrl, `${inv.number}.pdf`);
    } catch (err) {
      notify(errorMessage(err, 'We could not open that document.'), 'error');
    } finally {
      setSharing(false);
    }
  };

  const doSend = async () => {
    try {
      await send.mutateAsync();
      notify('Invoice sent.', 'success');
      setConfirmSend(false);
    } catch (err) {
      setConfirmSend(false);
      notify(errorMessage(err), 'error');
    }
  };

  const doVoid = async () => {
    try {
      await voidInvoice.mutateAsync(voidReason.trim());
      notify('Invoice voided. It stays on the record.', 'info');
      setVoidOpen(false);
      setVoidReason('');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll refreshing={invoice.isRefetching} onRefresh={() => void invoice.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" accessibilityRole="header">{inv.number}</Text>
            <Text variant="caption" tone="muted">
              {isProvider ? inv.client.fullName : inv.provider.businessName}
              {inv.job ? ` · ${inv.job.title}` : ''}
            </Text>
          </View>
          <Badge label={look.label} tone={look.tone} />
        </View>
      </Stack>

      {voided ? (
        <Banner
          tone="neutral"
          title="This invoice is void"
          message="It is kept for the record and no longer counts towards what is owed."
        />
      ) : !settled && !isProvider ? (
        <Banner
          tone="warning"
          title={`${formatMoney(inv.balanceCents, inv.currency)} outstanding`}
          message={
            inv.dueDate
              ? `Due ${formatDate(inv.dueDate)}. Pay your professional directly — Ruvik does not take the payment.`
              : 'Pay your professional directly — Ruvik does not take the payment.'
          }
        />
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Line items" />
        <DocumentLines lines={inv.lines} currency={inv.currency} />
      </Stack>

      <DocumentTotals
        currency={inv.currency}
        subtotalCents={inv.subtotalCents}
        discountCents={inv.discountCents}
        taxCents={inv.taxCents}
        totalCents={inv.totalCents}
        taxableBaseCents={inv.taxableBaseCents}
        untaxedBaseCents={inv.untaxedBaseCents}
        taxJurisdiction={inv.taxJurisdiction}
        amountPaidCents={inv.amountPaidCents}
        balanceCents={inv.balanceCents}
      />

      <Card>
        <Stack gap={2}>
          <Text variant="heading" style={{ marginBottom: spacing.xs }}>Dates</Text>
          <DetailRow label="Issued" value={formatDate(inv.issueDate)} />
          {inv.dueDate ? <DetailRow label="Due" value={formatDate(inv.dueDate)} /> : null}
          {inv.sentAt ? <DetailRow label="Sent" value={formatDate(inv.sentAt)} /> : null}
          {inv.firstViewedAt ? (
            <DetailRow label="First opened" value={formatDateTime(inv.firstViewedAt)} />
          ) : null}
          {inv.paidAt ? <DetailRow label="Paid" value={formatDate(inv.paidAt)} tone="success" /> : null}
          {inv.serviceAddress?.region ? (
            <DetailRow
              label="Work location"
              value={[
                inv.serviceAddress.city,
                inv.serviceAddress.region,
                inv.serviceAddress.postalCode,
              ].filter(Boolean).join(', ')}
            />
          ) : null}
        </Stack>
      </Card>

      {inv.payments.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title={`Payments (${inv.payments.length})`} />
          <Card padded={false}>
            {inv.payments.map((payment, index) => (
              <View key={payment.id ?? index}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <ListRow
                  title={formatMoney(payment.amountCents, inv.currency)}
                  subtitle={payment.receiptNumber ?? payment.method ?? undefined}
                  meta={payment.paidAt ? formatDateTime(payment.paidAt) : undefined}
                />
              </View>
            ))}
          </Card>
        </Stack>
      ) : null}

      {inv.notes ? (
        <Card>
          <Stack gap={2}>
            <Text variant="micro" tone="muted" uppercase>Notes</Text>
            <Text variant="caption" tone="muted">{inv.notes}</Text>
          </Stack>
        </Card>
      ) : null}

      <Stack gap={spacing.sm}>
        {isProvider && !voided && inv.status === 'draft' ? (
          <Button
            label="Send to customer"
            icon="paper-plane-outline"
            loading={send.isPending}
            haptic
            onPress={() => setConfirmSend(true)}
          />
        ) : null}

        {isProvider && !voided && !settled ? (
          <Button
            label="Record a payment"
            icon="cash-outline"
            onPress={() => setPaymentOpen(true)}
          />
        ) : null}

        {inv.pdfUrl ? (
          <Button
            label="Share PDF"
            variant="secondary"
            icon="share-outline"
            loading={sharing}
            onPress={() => void share()}
          />
        ) : null}

        {isProvider && !voided && inv.amountPaidCents === 0 ? (
          <Button
            label="Void this invoice"
            variant="secondary"
            icon="close-circle-outline"
            onPress={() => setVoidOpen(true)}
          />
        ) : null}
      </Stack>

      {/* Mounted only while open, so the amount starts at the balance as it
          stands right now and each opening gets its own idempotency key. */}
      {paymentOpen ? (
        <PaymentSheet
          onClose={() => setPaymentOpen(false)}
          invoiceId={inv.id}
          balanceCents={inv.balanceCents}
          currency={inv.currency}
        />
      ) : null}

      <ConfirmSheet
        visible={confirmSend}
        onClose={() => setConfirmSend(false)}
        title="Send this invoice?"
        message="The customer is notified and can open it. Sending does not take payment — you record that yourself once the money arrives."
        confirmLabel="Send invoice"
        tone="primary"
        busy={send.isPending}
        onConfirm={() => void doSend()}
      />

      <ConfirmSheet
        visible={voidOpen}
        onClose={() => setVoidOpen(false)}
        title="Void this invoice?"
        message="Voiding cannot be undone. The invoice stays on the record with its number intact — which is exactly why it is voided rather than deleted."
        confirmLabel="Void invoice"
        busy={voidInvoice.isPending}
        onConfirm={() => void doVoid()}
      >
        <Input
          label="Reason"
          placeholder="Raised against the wrong job."
          value={voidReason}
          onChangeText={setVoidReason}
          hint="Kept with the invoice, so the void is explained later."
        />
      </ConfirmSheet>
    </ScreenScroll>
  );
}

/**
 * Recording money already received — cash, a transfer, a card taken on a
 * reader. Ruvik does not move the money; it records that it moved.
 */
function PaymentSheet({
  onClose, invoiceId, balanceCents, currency,
}: {
  onClose: () => void;
  invoiceId: string;
  balanceCents: number;
  currency: string;
}) {
  const { notify } = useFeedback();
  const record = useRecordPayment(invoiceId);
  const [amount, setAmount] = useState(centsToInput(balanceCents));
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('cash');
  const [reference, setReference] = useState('');

  /**
   * One key for the life of this sheet, reused across every retry.
   *
   * That is the whole point of the header: a timeout the phone retries must
   * replay the first payment rather than book a second one. A key minted per
   * attempt would defeat it entirely.
   */
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const parsed = parseAmountToCents(amount);
  const overBalance = parsed.cents !== null && parsed.cents > balanceCents;

  const submit = async () => {
    if (parsed.cents === null) return;
    try {
      const result = await record.mutateAsync({
        amountCents: parsed.cents,
        method,
        reference: reference.trim() || undefined,
        idempotencyKey,
      });
      notify(
        result.balanceCents === 0
          ? `Paid in full. Receipt ${result.payment.receiptNumber}.`
          : `Recorded. ${formatMoney(result.balanceCents, currency)} still outstanding.`,
        'success',
      );
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Record a payment"
      subtitle={`${formatMoney(balanceCents, currency)} outstanding.`}
    >
      <Input
        label="Amount received"
        keyboardType="decimal-pad"
        leftIcon="cash-outline"
        value={amount}
        onChangeText={setAmount}
        error={
          parsed.error
            // The server rejects an over-payment with a 409; saying so here
            // saves a round trip and an alarming error.
            ?? (overBalance ? 'That is more than the outstanding balance.' : undefined)
        }
      />

      <Segmented
        label="How were you paid?"
        options={[
          { value: 'cash' as const, label: 'Cash' },
          { value: 'card' as const, label: 'Card' },
          { value: 'transfer' as const, label: 'Transfer' },
        ]}
        value={method}
        onChange={setMethod}
      />

      <Input
        label="Reference (optional)"
        placeholder="Cheque number, transfer reference…"
        value={reference}
        onChangeText={setReference}
      />

      <Button
        label="Record payment"
        disabled={parsed.cents === null || overBalance}
        loading={record.isPending}
        haptic
        onPress={() => void submit()}
      />
    </Sheet>
  );
}
