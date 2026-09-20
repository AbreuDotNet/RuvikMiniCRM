import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { RequireSession } from '../../src/components/Guard';
import { DocumentLines, DocumentTotals } from '../../src/components/DocumentView';
import {
  Badge, Banner, Button, Card, ConfirmSheet, DetailRow, ErrorState,
  ScreenScroll, SectionHeader, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useQuote, useRespondToQuote, useSendQuote } from '../../src/features/quotes/hooks';
import { shareDocument } from '../../src/services/files';
import { errorMessage } from '../../src/services/api';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';
import { formatDate } from '../../src/utils/format';
import { quoteStatus } from '../../src/utils/status';

export default function QuoteRoute() {
  return (
    <RequireSession>
      <QuoteDetailScreen />
    </RequireSession>
  );
}

function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const quoteId = id ?? '';
  const { user } = useAuth();
  const { notify } = useFeedback();

  const quote = useQuote(quoteId);
  const send = useSendQuote(quoteId);
  const respond = useRespondToQuote(quoteId);

  const [confirm, setConfirm] = useState<'send' | 'accept' | 'decline' | null>(null);
  const [sharing, setSharing] = useState(false);

  if (quote.isPending) {
    return <ScreenScroll><SkeletonList rows={4} /></ScreenScroll>;
  }
  if (quote.isError || !quote.data) {
    return (
      <ScreenScroll>
        <ErrorState error={quote.error} onRetry={() => void quote.refetch()} />
      </ScreenScroll>
    );
  }

  const q = quote.data;
  const look = quoteStatus(q.status);
  const isProvider = user?.role === 'provider';
  const isCustomer = user?.role === 'customer';

  const share = async () => {
    if (!q.pdfUrl) return;
    setSharing(true);
    try {
      await shareDocument(q.pdfUrl, `${q.number}.pdf`);
    } catch (err) {
      notify(errorMessage(err, 'We could not open that document.'), 'error');
    } finally {
      setSharing(false);
    }
  };

  const act = async (action: 'send' | 'accept' | 'decline') => {
    try {
      if (action === 'send') {
        await send.mutateAsync();
        notify('Quote sent. The customer has been notified.', 'success');
      } else {
        await respond.mutateAsync(action === 'accept' ? 'accept' : 'decline');
        notify(
          action === 'accept'
            ? 'Accepted. The professional can now schedule the work.'
            : 'Declined. They will be told.',
          action === 'accept' ? 'success' : 'info',
        );
      }
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      notify(errorMessage(err), 'error');
    }
  };

  const busy = send.isPending || respond.isPending;

  return (
    <ScreenScroll refreshing={quote.isRefetching} onRefresh={() => void quote.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" accessibilityRole="header">{q.number}</Text>
            <Text variant="caption" tone="muted">{q.job.title}</Text>
          </View>
          <Badge label={look.label} tone={look.tone} />
        </View>
        {look.hint ? <Text variant="caption" tone="muted">{look.hint}</Text> : null}
      </Stack>

      {q.invoice ? (
        <Banner
          tone="success"
          title={`Invoiced as ${q.invoice.number}`}
          message="This quote has already been turned into an invoice."
          action={{
            label: 'Open the invoice',
            onPress: () => router.push({ pathname: '/invoice/[id]', params: { id: q.invoice!.id } }),
          }}
        />
      ) : null}

      {isCustomer && q.status === 'sent' ? (
        <Banner
          tone="primary"
          title="Waiting on you"
          message={
            q.validUntil
              ? `Accepting books the work in. This quote is valid until ${formatDate(q.validUntil)}.`
              : 'Accepting books the work in.'
          }
        />
      ) : null}

      <Card>
        <Stack gap={2}>
          <Text variant="heading" style={{ marginBottom: spacing.xs }}>
            {isProvider ? 'For' : 'From'}
          </Text>
          <Text variant="bodyStrong">
            {isProvider ? q.client.fullName : q.provider.businessName}
          </Text>
          {isProvider ? (
            q.client.city ? <Text variant="caption" tone="muted">{q.client.city}</Text> : null
          ) : (
            <Text variant="caption" tone="muted">
              {[q.provider.tagline, q.provider.city].filter(Boolean).join(' · ')}
            </Text>
          )}
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Line items" />
        <DocumentLines lines={q.lines} currency={q.currency} />
      </Stack>

      <DocumentTotals
        currency={q.currency}
        subtotalCents={q.subtotalCents}
        discountCents={q.discountCents}
        taxCents={q.taxCents}
        totalCents={q.totalCents}
        taxableBaseCents={q.taxableBaseCents}
        untaxedBaseCents={q.untaxedBaseCents}
        taxJurisdiction={q.taxJurisdiction}
      />

      {q.notes || q.terms ? (
        <Card>
          <Stack gap={spacing.sm}>
            {q.notes ? (
              <Stack gap={2}>
                <Text variant="micro" tone="muted" uppercase>Notes</Text>
                <Text variant="caption" tone="muted">{q.notes}</Text>
              </Stack>
            ) : null}
            {q.terms ? (
              <Stack gap={2}>
                <Text variant="micro" tone="muted" uppercase>Terms</Text>
                <Text variant="caption" tone="muted">{q.terms}</Text>
              </Stack>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      <Card>
        <Stack gap={2}>
          <DetailRow label="Created" value={formatDate(q.createdAt)} />
          {q.sentAt ? <DetailRow label="Sent" value={formatDate(q.sentAt)} /> : null}
          {q.acceptedAt ? <DetailRow label="Accepted" value={formatDate(q.acceptedAt)} tone="success" /> : null}
          {q.declinedAt ? <DetailRow label="Declined" value={formatDate(q.declinedAt)} tone="danger" /> : null}
          {q.validUntil ? <DetailRow label="Valid until" value={formatDate(q.validUntil)} /> : null}
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        {isProvider && q.status === 'draft' ? (
          <Button
            label="Send to customer"
            icon="paper-plane-outline"
            loading={busy}
            haptic
            onPress={() => setConfirm('send')}
          />
        ) : null}

        {isProvider && q.status === 'accepted' && !q.invoice ? (
          <Button
            label="Raise an invoice"
            icon="receipt-outline"
            onPress={() => router.push({ pathname: '/invoice/new', params: { quoteId: q.id } })}
          />
        ) : null}

        {isCustomer && q.status === 'sent' ? (
          <>
            <Button
              label="Accept this quote"
              icon="checkmark-circle-outline"
              loading={busy}
              haptic
              onPress={() => setConfirm('accept')}
            />
            <Button
              label="Decline"
              variant="secondary"
              disabled={busy}
              onPress={() => setConfirm('decline')}
            />
          </>
        ) : null}

        {/* The PDF link is signed and expiring, so it can go to the share
            sheet — and from there to WhatsApp, email or Files — without a
            bearer token travelling with it. */}
        {q.pdfUrl ? (
          <Button
            label="Share PDF"
            variant="secondary"
            icon="share-outline"
            loading={sharing}
            onPress={() => void share()}
          />
        ) : q.status !== 'draft' ? (
          <Text variant="micro" tone="faint" align="center">
            The PDF is still being generated. Pull to refresh in a moment.
          </Text>
        ) : null}
      </Stack>

      <ConfirmSheet
        visible={confirm === 'send'}
        onClose={() => setConfirm(null)}
        title="Send this quote?"
        message="Once sent, the quote is frozen: the customer sees exactly these figures and the lines can no longer be edited."
        confirmLabel="Send quote"
        tone="primary"
        busy={busy}
        onConfirm={() => void act('send')}
      />

      <ConfirmSheet
        visible={confirm === 'accept'}
        onClose={() => setConfirm(null)}
        title="Accept this quote?"
        message="This approves the work at these prices and lets the professional schedule it. They can then invoice you for the agreed amount."
        confirmLabel="Accept"
        tone="primary"
        busy={busy}
        onConfirm={() => void act('accept')}
      />

      <ConfirmSheet
        visible={confirm === 'decline'}
        onClose={() => setConfirm(null)}
        title="Decline this quote?"
        message="The professional will be told. You can still ask them for a new quote afterwards."
        confirmLabel="Decline"
        busy={busy}
        onConfirm={() => void act('decline')}
      />
    </ScreenScroll>
  );
}
