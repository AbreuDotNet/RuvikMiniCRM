import { View } from 'react-native';
import { router } from 'expo-router';

import { PageHeader } from '../../src/components/PageHeader';
import {
  Badge, Banner, Button, Card, Divider, EmptyState, ErrorState, ListRow,
  ScreenScroll, SectionHeader, SkeletonList, Stack, StatTile, Text,
} from '../../src/components/ui';
import { useProviderDashboard } from '../../src/features/provider/hooks';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';
import { formatDateTime, formatMoneyCompact } from '../../src/utils/format';
import { jobStatus, listingsAreLive, subscriptionStatus, verificationStatus } from '../../src/utils/status';

export default function ProviderDashboard() {
  const { user } = useAuth();
  const dashboard = useProviderDashboard();

  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const subscription = dashboard.data?.subscription ?? null;
  const listingsLive = listingsAreLive(subscription?.status ?? user?.subscriptionStatus);

  return (
    <ScreenScroll
      refreshing={dashboard.isRefetching}
      onRefresh={() => void dashboard.refetch()}
    >
      <PageHeader
        title={`Hi, ${firstName}`}
        subtitle="Here is where the work stands."
        trailing={
          <Button
            label="Calendar"
            variant="secondary"
            size="sm"
            icon="calendar-outline"
            fullWidth={false}
            onPress={() => router.push('/calendar')}
          />
        }
      />

      {/* Two things can quietly make a provider invisible: an unpublished or
          unverified profile, and a lapsed subscription. Both are said here
          with the fix one tap away, because the alternative is a provider
          wondering why the phone stopped ringing. */}
      {!listingsLive ? (
        <Banner
          tone="warning"
          title="Your listings are not in search"
          message={
            subscription
              ? `Your plan is ${subscriptionStatus(subscription.status).label.toLowerCase()}. Listings appear in search while a plan is live.`
              : 'Choose a plan — the free one included — to appear in search results.'
          }
          action={{ label: 'Open subscription', onPress: () => router.push('/subscription') }}
        />
      ) : null}

      {user?.providerStatus && user.providerStatus !== 'verified' ? (
        <Banner
          tone="info"
          title={verificationStatus(user.providerStatus).label}
          message="Verified businesses get a badge in search and win more work."
          action={{ label: 'See what is needed', onPress: () => router.push('/verification') }}
        />
      ) : null}

      {dashboard.isPending ? (
        <SkeletonList rows={3} />
      ) : dashboard.isError ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : dashboard.data ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
            <StatTile
              label="New leads"
              value={String(dashboard.data.newLeads)}
              caption="Waiting on a first reply"
              tone={dashboard.data.newLeads > 0 ? 'info' : 'neutral'}
              onPress={() => router.push({ pathname: '/(provider)/jobs', params: { status: 'new_lead' } })}
            />
            <StatTile
              label="Upcoming"
              value={String(dashboard.data.upcomingJobs)}
              caption="Scheduled work"
              onPress={() => router.push({ pathname: '/(provider)/jobs', params: { status: 'scheduled' } })}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
            <StatTile
              label="Outstanding"
              value={formatMoneyCompact(dashboard.data.outstandingCents)}
              caption="Invoiced, not yet paid"
              tone={dashboard.data.outstandingCents > 0 ? 'warning' : 'neutral'}
              onPress={() => router.push('/(provider)/money')}
            />
            <StatTile
              label="Overdue"
              value={formatMoneyCompact(dashboard.data.overdueCents)}
              caption="Past the due date"
              tone={dashboard.data.overdueCents > 0 ? 'danger' : 'neutral'}
              onPress={() => router.push({ pathname: '/(provider)/money', params: { status: 'overdue' } })}
            />
          </View>

          <Stack gap={spacing.sm}>
            <SectionHeader
              title="Next up"
              action={{ label: 'All jobs', onPress: () => router.push('/(provider)/jobs') }}
            />
            {!dashboard.data.upcomingSchedule.length ? (
              <Card>
                <EmptyState
                  icon="calendar-outline"
                  title="Nothing scheduled"
                  message="Once a job has a date, the next few appear here."
                  action={{ label: 'Create a job', onPress: () => router.push('/job/new') }}
                />
              </Card>
            ) : (
              <Card padded={false}>
                {dashboard.data.upcomingSchedule.map((job, index) => {
                  const look = jobStatus(job.status);
                  return (
                    <View key={job.id}>
                      {index > 0 ? <Divider inset={spacing.lg} /> : null}
                      <ListRow
                        title={job.title}
                        subtitle={job.clientName}
                        meta={job.scheduledStart ? formatDateTime(job.scheduledStart) : 'No date set'}
                        trailing={<Badge label={look.label} tone={look.tone} />}
                        onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
                      />
                    </View>
                  );
                })}
              </Card>
            )}
          </Stack>

          <Stack gap={spacing.sm}>
            <SectionHeader title="Pipeline" />
            <Card>
              <Stack gap={spacing.sm}>
                {Object.entries(dashboard.data.jobsByStatus).length === 0 ? (
                  <Text variant="caption" tone="muted">No jobs yet.</Text>
                ) : (
                  Object.entries(dashboard.data.jobsByStatus).map(([status, count]) => {
                    const look = jobStatus(status);
                    return (
                      <View
                        key={status}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                      >
                        <Badge label={look.label} tone={look.tone} />
                        <View style={{ flex: 1 }} />
                        <Text variant="bodyStrong">{count}</Text>
                        <Text
                          variant="caption"
                          tone="primary"
                          accessibilityRole="link"
                          onPress={() => router.push({
                            pathname: '/(provider)/jobs', params: { status },
                          })}
                        >
                          View
                        </Text>
                      </View>
                    );
                  })
                )}
              </Stack>
            </Card>
          </Stack>

          <Stack gap={spacing.sm}>
            <SectionHeader title="Quick actions" />
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Button
                label="New job"
                icon="add"
                fullWidth={false}
                style={{ flexGrow: 1 }}
                onPress={() => router.push('/job/new')}
              />
              <Button
                label="New quote"
                variant="secondary"
                icon="document-text-outline"
                fullWidth={false}
                style={{ flexGrow: 1 }}
                onPress={() => router.push('/quote/new')}
              />
              <Button
                label="New invoice"
                variant="secondary"
                icon="receipt-outline"
                fullWidth={false}
                style={{ flexGrow: 1 }}
                onPress={() => router.push('/invoice/new')}
              />
            </View>
          </Stack>
        </>
      ) : null}
    </ScreenScroll>
  );
}
