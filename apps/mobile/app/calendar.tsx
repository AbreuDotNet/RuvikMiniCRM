import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { RequireRole } from '../src/components/Guard';
import {
  Badge, Card, Divider, EmptyState, ErrorState, IconButton, ListRow,
  ScreenScroll, SkeletonList, Stack, Text,
} from '../src/components/ui';
import { useCalendar } from '../src/features/crm/hooks';
import { spacing } from '../src/theme/tokens';
import { formatTime, formatWeekday, toIsoDate } from '../src/utils/format';
import { jobStatus } from '../src/utils/status';
import type { CalendarJob } from '../src/types/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function CalendarRoute() {
  return (
    <RequireRole role="provider">
      <CalendarScreen />
    </RequireRole>
  );
}

/**
 * An agenda, not a grid.
 *
 * A month grid on a phone gives each day a square too small to show what is
 * in it, so it becomes a date picker with dots. A list of the days that
 * actually have work tells a one-person business what it needs: what is next,
 * for whom, and where.
 */
function CalendarScreen() {
  const [offset, setOffset] = useState(0);

  const { from, to, label } = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() + offset);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 0);

    return {
      // Full ISO instants, not `YYYY-MM-DD`: the endpoint validates these as
      // datetimes and rejects a bare date with a 422.
      from: start.toISOString(),
      to: end.toISOString(),
      label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`,
    };
  }, [offset]);

  const calendar = useCalendar(from, to);

  const days = useMemo(() => groupByDay(calendar.data ?? []), [calendar.data]);

  return (
    <ScreenScroll refreshing={calendar.isRefetching} onRefresh={() => void calendar.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => setOffset((o) => o - 1)} />
        <Text variant="heading" align="center" style={{ flex: 1 }}>{label}</Text>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => setOffset((o) => o + 1)} />
      </View>

      {offset !== 0 ? (
        <Text
          variant="caption"
          tone="primary"
          align="center"
          accessibilityRole="button"
          onPress={() => setOffset(0)}
        >
          Back to this month
        </Text>
      ) : null}

      {calendar.isPending ? (
        <SkeletonList rows={3} />
      ) : calendar.isError ? (
        <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : !days.length ? (
        <Card>
          <EmptyState
            icon="calendar-outline"
            title="Nothing booked"
            message="Jobs appear here once they have a date. Schedule one from its job screen."
          />
        </Card>
      ) : (
        days.map((day) => (
          <Stack key={day.key} gap={spacing.sm}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
              <Text variant="heading">{day.dayOfMonth}</Text>
              <Text variant="caption" tone="muted">{day.weekday}</Text>
              <View style={{ flex: 1 }} />
              <Text variant="micro" tone="faint">
                {day.jobs.length} job{day.jobs.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Card padded={false}>
              {day.jobs.map((job, index) => {
                const look = jobStatus(job.status);
                return (
                  <View key={job.id}>
                    {index > 0 ? <Divider inset={spacing.lg} /> : null}
                    <ListRow
                      title={job.title}
                      subtitle={job.clientName}
                      meta={[formatTime(job.scheduledStart), job.city].filter(Boolean).join(' · ')}
                      trailing={<Badge label={look.label} tone={look.tone} />}
                      onPress={() => router.push({ pathname: '/job/[id]', params: { id: job.id } })}
                    />
                  </View>
                );
              })}
            </Card>
          </Stack>
        ))
      )}
    </ScreenScroll>
  );
}

interface Day {
  key: string;
  dayOfMonth: number;
  weekday: string;
  jobs: CalendarJob[];
}

function groupByDay(jobs: CalendarJob[]): Day[] {
  const buckets = new Map<string, CalendarJob[]>();

  for (const job of jobs) {
    const date = new Date(job.scheduledStart);
    if (Number.isNaN(date.getTime())) continue;
    const key = toIsoDate(date);
    const existing = buckets.get(key);
    if (existing) existing.push(job);
    else buckets.set(key, [job]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, dayJobs]) => {
      const date = new Date(`${key}T00:00:00`);
      return {
        key,
        dayOfMonth: date.getDate(),
        weekday: formatWeekday(date.toISOString()),
        jobs: dayJobs.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
      };
    });
}
