import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  Badge, Button, Card, DetailRow, ErrorState, ScreenScroll, SkeletonList, Stack, Text,
} from '../../src/components/ui';
import { useServiceDetail } from '../../src/features/discovery/hooks';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';
import { formatMoney } from '../../src/utils/format';

export default function ServiceDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const service = useServiceDetail(id ?? '');
  const { user } = useAuth();

  if (service.isPending) {
    return <ScreenScroll><SkeletonList rows={3} /></ScreenScroll>;
  }
  if (service.isError || !service.data) {
    return (
      <ScreenScroll>
        <ErrorState error={service.error} onRetry={() => void service.refetch()} />
      </ScreenScroll>
    );
  }

  const s = service.data;
  const price = s.pricingType === 'request_quote'
    ? 'Price on request'
    : `${s.pricingType === 'starting_at' ? 'From ' : ''}${formatMoney(s.priceCents, s.currency)}`;

  return (
    <ScreenScroll>
      <Stack gap={spacing.xs}>
        <Text variant="micro" tone="muted" uppercase>{s.category.name}</Text>
        <Text variant="title" accessibilityRole="header">{s.title}</Text>
        <Text variant="heading" tone="primary">{price}</Text>
      </Stack>

      {s.description || s.shortDescription ? (
        <Card>
          <Text variant="body" tone="muted">{s.description ?? s.shortDescription}</Text>
        </Card>
      ) : null}

      <Card>
        <Stack gap={4}>
          <Text variant="heading">Details</Text>
          {s.estimatedDurationMin ? (
            <DetailRow label="Typical duration" value={formatDuration(s.estimatedDurationMin)} />
          ) : null}
          {s.coverageArea ? <DetailRow label="Coverage" value={s.coverageArea} /> : null}
          <DetailRow
            label="Pricing"
            value={
              s.pricingType === 'fixed' ? 'Fixed price'
                : s.pricingType === 'starting_at' ? 'Starting price' : 'Quoted per job'
            }
          />
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.sm}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="heading" style={{ flex: 1 }}>{s.provider.businessName}</Text>
            {s.provider.verificationStatus === 'verified' ? (
              <Badge label="Verified" tone="success" icon="shield-checkmark" />
            ) : null}
          </View>
          <Text variant="caption" tone="muted">
            {s.provider.city ?? 'Location not set'}
            {' · '}
            {s.provider.ratingCount > 0
              ? `${s.provider.ratingAvg.toFixed(1)} ★ (${s.provider.ratingCount})`
              : 'No reviews yet'}
          </Text>
          <Button
            label="See full profile"
            variant="secondary"
            size="sm"
            onPress={() => router.push({
              pathname: '/provider/[slug]', params: { slug: s.provider.slug },
            })}
          />
        </Stack>
      </Card>

      {user?.role === 'customer' ? (
        <Button
          label="Request a quote"
          icon="chatbubble-ellipses-outline"
          onPress={() => router.push({
            pathname: '/request/new',
            params: { providerId: s.provider.id, serviceId: s.id, title: s.title },
          })}
        />
      ) : !user ? (
        <Button
          label="Sign in to request a quote"
          variant="secondary"
          onPress={() => router.push('/(auth)/sign-in')}
        />
      ) : null}
    </ScreenScroll>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
