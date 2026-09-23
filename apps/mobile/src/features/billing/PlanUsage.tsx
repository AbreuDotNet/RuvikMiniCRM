import { View } from 'react-native';

import { Badge, Card, SectionHeader, Stack, Text } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';
import {
  CAPABILITY_LABELS, usageFraction, usageLabel,
  type Entitlements, type UsageCheck,
} from './usage';

/**
 * What the plan allows and how much is left.
 *
 * Shown before someone runs into a limit rather than after: the point of a
 * quota screen is that the refusal is never a surprise. An exhausted
 * allowance is coloured, not hidden, because that is the one the person needs
 * to act on.
 */
export function PlanUsage({ entitlements }: { entitlements: Entitlements }) {
  const rows: { label: string; check: UsageCheck; period?: string }[] = [
    { label: 'Clients', check: entitlements.usage.clients },
    { label: 'Receipts', check: entitlements.usage.receiptsThisMonth, period: 'this month' },
    { label: 'Quotes', check: entitlements.usage.quotesThisMonth, period: 'this month' },
    { label: 'Listings', check: entitlements.usage.services },
  ];

  return (
    <Stack gap={spacing.sm}>
      <SectionHeader title={`What ${entitlements.plan.name} includes`} />

      <Card>
        <Stack gap={spacing.md}>
          {rows.map((row) => (
            <UsageRow key={row.label} label={row.label} check={row.check} period={row.period} />
          ))}
        </Stack>
      </Card>

      {entitlements.capabilities.length ? (
        <Card>
          <Stack gap={spacing.sm}>
            <Text variant="micro" tone="muted" uppercase>Also included</Text>
            {entitlements.capabilities.map((capability) => (
              <View
                key={capability}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <Text variant="caption" style={{ flex: 1 }}>
                  {CAPABILITY_LABELS[capability] ?? capability}
                </Text>
                {/* Honest rather than flattering: the plan grants it and the
                    product cannot do it yet. Finding that out from a missing
                    button is worse than reading it here. */}
                {entitlements.unimplemented.includes(capability) ? (
                  <Badge label="Coming" tone="warning" />
                ) : (
                  <Badge label="Ready" tone="success" />
                )}
              </View>
            ))}
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

function UsageRow({
  label, check, period,
}: {
  label: string;
  check: UsageCheck;
  period?: string;
}) {
  const theme = useTheme();
  const fraction = usageFraction(check);
  const unlimited = check.limit === null;

  const tone = check.exhausted
    ? theme.colors.danger
    : fraction >= 0.8 ? theme.colors.warning : theme.colors.primary;

  return (
    <Stack gap={6}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <Text variant="caption" style={{ flex: 1 }}>
          {label}
          {period ? <Text variant="micro" tone="faint"> {period}</Text> : null}
        </Text>
        <Text
          variant="caption"
          style={{ color: check.exhausted ? theme.colors.danger : theme.colors.text }}
        >
          {usageLabel(check)}
        </Text>
        {unlimited ? <Badge label="Unlimited" tone="success" /> : null}
      </View>

      {/* No bar for an unlimited allowance: a track that can never fill is a
          progress indicator that means nothing. */}
      {unlimited ? null : (
        <View
          style={{
            height: 4,
            borderRadius: radius.pill,
            backgroundColor: theme.colors.surfaceMuted,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.round(fraction * 100)}%`,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: tone,
            }}
          />
        </View>
      )}

      {check.exhausted ? (
        <Text variant="micro" tone="danger">
          You have used every one on this plan. Upgrade to add more.
        </Text>
      ) : null}
    </Stack>
  );
}
