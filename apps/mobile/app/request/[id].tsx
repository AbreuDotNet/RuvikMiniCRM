import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Button, Card, DetailRow, Divider, ErrorState, Input, ListRow,
  ScreenScroll, SectionHeader, Sheet, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useCustomerRequest, useSubmitReview } from '../../src/features/customer/hooks';
import { errorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatDateTime, formatMoney } from '../../src/utils/format';
import { invoiceStatus, jobStatus, quoteStatus } from '../../src/utils/status';

export default function RequestDetailRoute() {
  return (
    <RequireRole role="customer">
      <RequestDetail />
    </RequireRole>
  );
}

function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const request = useCustomerRequest(id ?? '');
  const [reviewOpen, setReviewOpen] = useState(false);

  if (request.isPending) {
    return <ScreenScroll><SkeletonList rows={4} /></ScreenScroll>;
  }
  if (request.isError || !request.data) {
    return (
      <ScreenScroll>
        <ErrorState error={request.error} onRetry={() => void request.refetch()} />
      </ScreenScroll>
    );
  }

  const r = request.data;
  const status = jobStatus(r.status);

  return (
    <ScreenScroll refreshing={request.isRefetching} onRefresh={() => void request.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" accessibilityRole="header">{r.title}</Text>
            <Text variant="caption" tone="muted">{r.reference}</Text>
          </View>
          <Badge label={status.label} tone={status.tone} />
        </View>
        {status.hint ? <Text variant="caption" tone="muted">{status.hint}</Text> : null}
      </Stack>

      <Card>
        <Stack gap={4}>
          <Text variant="heading">{r.provider.businessName}</Text>
          {r.provider.ratingAvg > 0 ? (
            <Text variant="caption" tone="muted">{r.provider.ratingAvg.toFixed(1)} ★</Text>
          ) : null}
          <Button
            label="View profile"
            variant="secondary"
            size="sm"
            style={{ marginTop: spacing.sm }}
            onPress={() => router.push({
              pathname: '/provider/[slug]', params: { slug: r.provider.slug },
            })}
          />
        </Stack>
      </Card>

      {r.description ? (
        <Card>
          <Stack gap={spacing.xs}>
            <Text variant="micro" tone="muted" uppercase>What you asked for</Text>
            <Text variant="body" tone="muted">{r.description}</Text>
          </Stack>
        </Card>
      ) : null}

      <Card>
        <Stack gap={2}>
          <Text variant="heading" style={{ marginBottom: spacing.xs }}>Details</Text>
          <DetailRow label="Opened" value={formatDate(r.createdAt)} />
          {r.addressLine || r.city ? (
            <DetailRow label="Where" value={[r.addressLine, r.city].filter(Boolean).join(', ')} />
          ) : null}
          {r.scheduledStart ? (
            <DetailRow label="Scheduled" value={formatDateTime(r.scheduledStart)} strong />
          ) : null}
          {r.completedAt ? <DetailRow label="Completed" value={formatDate(r.completedAt)} /> : null}
        </Stack>
      </Card>

      {r.quotes.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Quotes" />
          <Card padded={false}>
            {r.quotes.map((quote, index) => {
              const look = quoteStatus(quote.status);
              return (
                <View key={quote.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={formatMoney(quote.totalCents, quote.currency)}
                    subtitle={quote.number}
                    meta={
                      quote.validUntil
                        ? `Valid until ${formatDate(quote.validUntil)}`
                        : quote.sentAt ? `Sent ${formatDate(quote.sentAt)}` : undefined
                    }
                    trailing={<Badge label={look.label} tone={look.tone} />}
                    accessibilityHint={quote.status === 'sent' ? 'Open to accept or decline' : undefined}
                    onPress={() => router.push({ pathname: '/quote/[id]', params: { id: quote.id } })}
                  />
                </View>
              );
            })}
          </Card>
        </Stack>
      ) : null}

      {r.invoices.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Invoices" />
          <Card padded={false}>
            {r.invoices.map((invoice, index) => {
              const look = invoiceStatus(invoice.status);
              const outstanding = invoice.totalCents - invoice.amountPaidCents;
              return (
                <View key={invoice.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={formatMoney(invoice.totalCents, invoice.currency)}
                    subtitle={invoice.number}
                    meta={
                      outstanding > 0
                        ? `${formatMoney(outstanding, invoice.currency)} outstanding`
                        : 'Paid in full'
                    }
                    trailing={<Badge label={look.label} tone={look.tone} />}
                    onPress={() => router.push({
                      pathname: '/invoice/[id]', params: { id: invoice.id },
                    })}
                  />
                </View>
              );
            })}
          </Card>
        </Stack>
      ) : null}

      {r.comments.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Updates" />
          <Card padded={false}>
            {r.comments.map((comment, index) => (
              <View key={comment.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <View style={{ padding: spacing.lg, gap: 2 }}>
                  <Text variant="body">{comment.body}</Text>
                  <Text variant="micro" tone="faint">
                    {comment.authorName} · {formatDate(comment.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </Stack>
      ) : null}

      {r.myReview ? (
        <Card>
          <Stack gap={spacing.xs}>
            <Text variant="micro" tone="muted" uppercase>Your review</Text>
            <Text variant="heading" tone="warning">{'★'.repeat(r.myReview.rating)}</Text>
            {r.myReview.comment ? (
              <Text variant="caption" tone="muted">{r.myReview.comment}</Text>
            ) : null}
          </Stack>
        </Card>
      ) : r.canReview ? (
        <Button
          label="Leave a review"
          icon="star-outline"
          onPress={() => setReviewOpen(true)}
        />
      ) : null}

      <ReviewSheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        requestId={r.id}
      />
    </ScreenScroll>
  );
}

function ReviewSheet({
  visible, onClose, requestId,
}: {
  visible: boolean;
  onClose: () => void;
  requestId: string;
}) {
  const theme = useTheme();
  const { notify } = useFeedback();
  const submit = useSubmitReview(requestId);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const send = async () => {
    try {
      await submit.mutateAsync({ rating, comment: comment.trim() || undefined });
      notify('Thanks — your review is published.', 'success');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="How did it go?"
      subtitle="Reviews are public and can only be left once."
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Rating"
        style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <Ionicons
            key={value}
            name={value <= rating ? 'star' : 'star-outline'}
            size={36}
            color={value <= rating ? theme.colors.warning : theme.colors.borderStrong}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === rating }}
            accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
            onPress={() => setRating(value)}
          />
        ))}
      </View>

      <Input
        label="Anything to add?"
        placeholder="Turned up on time and cleaned up afterwards."
        multiline
        numberOfLines={4}
        value={comment}
        onChangeText={setComment}
      />

      <Button label="Publish review" loading={submit.isPending} onPress={() => void send()} />
    </Sheet>
  );
}
