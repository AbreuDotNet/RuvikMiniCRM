import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  Badge, Button, Card, Divider, ErrorState, ListRow, ScreenScroll,
  SectionHeader, SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useProviderProfile } from '../../src/features/discovery/hooks';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatMoney } from '../../src/utils/format';

export default function ProviderProfileRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const profile = useProviderProfile(slug ?? '');
  const { user } = useAuth();

  if (profile.isPending) {
    return (
      <ScreenScroll>
        <SkeletonList rows={4} />
      </ScreenScroll>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <ScreenScroll>
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </ScreenScroll>
    );
  }

  const p = profile.data;
  // Only a signed-in customer can open a request; anyone else is sent to the
  // right place rather than into a 403.
  const canRequest = user?.role === 'customer';

  return (
    <ScreenScroll refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text variant="display" accessibilityRole="header" style={{ flexShrink: 1 }}>
            {p.businessName}
          </Text>
          {p.verificationStatus === 'verified' ? (
            <Badge label="Verified" tone="success" icon="shield-checkmark" />
          ) : null}
        </View>
        {p.tagline ? <Text variant="body" tone="muted">{p.tagline}</Text> : null}
        <Text variant="caption" tone="faint">
          {[p.city, p.region].filter(Boolean).join(', ') || 'Location not set'}
          {' · '}
          {p.ratingCount > 0
            ? `${p.ratingAvg.toFixed(1)} ★ (${p.ratingCount})`
            : 'No reviews yet'}
          {' · '}
          {p.completedJobs} jobs completed
        </Text>
      </Stack>

      {p.bio ? (
        <Card>
          <Text variant="body" tone="muted">{p.bio}</Text>
        </Card>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title={`Services (${p.services.length})`} />
        {!p.services.length ? (
          <Card>
            <Text variant="caption" tone="muted">
              No listings published yet. You can still ask for a quote.
            </Text>
          </Card>
        ) : (
          <Card padded={false}>
            {p.services.map((service, index) => (
              <View key={service.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <ListRow
                  title={service.title}
                  subtitle={service.shortDescription ?? service.category.name}
                  meta={
                    service.pricingType === 'request_quote'
                      ? 'Price on request'
                      : `${service.pricingType === 'starting_at' ? 'From ' : ''}${formatMoney(service.priceCents, service.currency)}`
                  }
                  onPress={() => router.push({
                    pathname: '/service/[id]', params: { id: service.id },
                  })}
                />
              </View>
            ))}
          </Card>
        )}
      </Stack>

      {p.certifications.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Certifications" />
          <Card>
            <Stack gap={spacing.xs}>
              {p.certifications.map((certification) => (
                <Text key={certification} variant="caption" tone="muted">• {certification}</Text>
              ))}
            </Stack>
          </Card>
        </Stack>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title={`Reviews (${p.ratingCount})`} />
        {!p.reviews.length ? (
          <Card>
            <Text variant="caption" tone="muted">No reviews yet.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {p.reviews.map((review, index) => (
              <View key={review.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <View style={{ padding: spacing.lg, gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="bodyStrong">{review.customerName}</Text>
                    <Text variant="caption" tone="warning">{'★'.repeat(review.rating)}</Text>
                  </View>
                  {review.comment ? (
                    <Text variant="caption" tone="muted">{review.comment}</Text>
                  ) : null}
                  <Text variant="micro" tone="faint">{formatDate(review.createdAt)}</Text>
                  {review.providerReply ? (
                    <Text variant="micro" tone="muted" style={{ marginTop: 4 }}>
                      Reply: {review.providerReply}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        )}
      </Stack>

      {canRequest ? (
        <Button
          label="Request a quote"
          icon="chatbubble-ellipses-outline"
          onPress={() => router.push({
            pathname: '/request/new', params: { providerId: p.id },
          })}
        />
      ) : !user ? (
        <Button
          label="Sign in to request a quote"
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
        />
      ) : null}

      <Text variant="micro" tone="faint" align="center">
        On Ruvik since {formatDate(p.memberSince)}
      </Text>
    </ScreenScroll>
  );
}
