import { useState } from 'react';
import { View } from 'react-native';

import { RequireRole } from '../src/components/Guard';
import {
  Badge, Banner, Button, Card, ConfirmSheet, DetailRow, Divider, ErrorState,
  ListRow, ScreenScroll, SectionHeader, SkeletonList, Stack, Text, useFeedback,
} from '../src/components/ui';
import {
  useCancelSubscription, usePlans, useStartSubscription, useSubscription,
} from '../src/features/billing/hooks';
import { PlanUsage } from '../src/features/billing/PlanUsage';
import { useEntitlements } from '../src/features/billing/usage';
import { openInAppBrowser } from '../src/services/files';
import { errorMessage } from '../src/services/api';
import { useAuth } from '../src/state/auth';
import { spacing } from '../src/theme/tokens';
import { formatDate, formatMoney } from '../src/utils/format';
import { listingsAreLive, subscriptionStatus } from '../src/utils/status';

export default function SubscriptionRoute() {
  return (
    <RequireRole role="provider">
      <SubscriptionScreen />
    </RequireRole>
  );
}

function SubscriptionScreen() {
  const { notify } = useFeedback();
  const { refreshUser } = useAuth();

  const plans = usePlans();
  const subscription = useSubscription();
  const entitlements = useEntitlements();
  const start = useStartSubscription();
  const cancel = useCancelSubscription();

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const current = subscription.data;
  const live = listingsAreLive(current?.status);

  const subscribe = async (planCode: string) => {
    setBusyPlan(planCode);
    try {
      const result = await start.mutateAsync(planCode);

      if (!result.checkout) {
        // A free plan has nothing to charge, so the server activates it on the
        // spot. There is no webhook coming and waiting for one would strand it.
        notify('Your plan is active and your listings are live.', 'success');
      } else if (result.checkout.url) {
        // A hosted checkout: open it, and let the provider's signed webhook
        // activate the plan. Coming back to the app proves nothing about
        // whether the payment succeeded, so nothing here claims it did.
        await openInAppBrowser(result.checkout.url);
        notify('Finish the payment in the browser. Your plan activates once it clears.', 'info');
      } else {
        notify(
          `Checkout started for ${formatMoney(result.checkout.amountCents, result.checkout.currency)}. `
          + 'Your plan activates once payment is confirmed.',
          'info',
        );
      }

      await refreshUser();
      void entitlements.refetch();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusyPlan(null);
    }
  };

  const endPlan = async () => {
    try {
      await cancel.mutateAsync(false);
      notify('Your plan will end when the current period finishes.', 'info');
      setConfirmCancel(false);
      await refreshUser();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll
      refreshing={subscription.isRefetching}
      onRefresh={() => void subscription.refetch()}
    >
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Subscription</Text>
        <Text variant="caption" tone="muted">
          Ruvik charges you a subscription. It takes no cut of what your customers pay you.
        </Text>
      </Stack>

      {subscription.isPending ? (
        <SkeletonList rows={2} />
      ) : subscription.isError ? (
        <ErrorState error={subscription.error} onRetry={() => void subscription.refetch()} />
      ) : current ? (
        <Card>
          <Stack gap={spacing.sm}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="heading" style={{ flex: 1 }}>{current.plan.name}</Text>
              <Badge
                label={subscriptionStatus(current.status).label}
                tone={subscriptionStatus(current.status).tone}
              />
            </View>

            <Stack gap={2}>
              <DetailRow
                label="Price"
                value={
                  current.plan.priceCents === 0
                    ? 'Free'
                    : `${formatMoney(current.plan.priceCents, current.plan.currency)} / ${current.plan.interval}`
                }
              />
              {current.currentPeriodEnd ? (
                <DetailRow
                  label={current.cancelAtPeriodEnd ? 'Ends' : 'Renews'}
                  value={formatDate(current.currentPeriodEnd)}
                />
              ) : null}
              {current.plan.maxServices != null ? (
                <DetailRow label="Listings allowed" value={String(current.plan.maxServices)} />
              ) : null}
            </Stack>

            {!live ? (
              <Banner
                tone="warning"
                message="While your plan is not live, your listings do not appear in search."
              />
            ) : current.cancelAtPeriodEnd ? (
              <Banner
                tone="warning"
                message={
                  current.currentPeriodEnd
                    ? `Your plan runs until ${formatDate(current.currentPeriodEnd)}. After that your listings stop appearing in search.`
                    : 'Your plan ends at the close of this period, and your listings stop appearing in search.'
                }
              />
            ) : null}
          </Stack>
        </Card>
      ) : (
        <Banner
          tone="warning"
          title="No plan yet"
          message="Choose a plan — the free one included — for your listings to appear in search."
        />
      )}

      {entitlements.data ? <PlanUsage entitlements={entitlements.data} /> : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Plans" />
        {plans.isPending ? (
          <SkeletonList rows={2} />
        ) : plans.isError ? (
          <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
        ) : (
          (plans.data ?? []).map((plan) => {
            const isCurrent = current?.plan.code === plan.code;
            return (
              <Card key={plan.id}>
                <Stack gap={spacing.sm}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text variant="heading" style={{ flex: 1 }}>{plan.name}</Text>
                    {isCurrent ? <Badge label="Current" tone="primary" /> : null}
                  </View>

                  <Text variant="title">
                    {plan.priceCents === 0
                      ? 'Free'
                      : `${formatMoney(plan.priceCents, plan.currency)}`}
                    {plan.priceCents === 0 ? '' : (
                      <Text variant="caption" tone="muted"> / {plan.interval}</Text>
                    )}
                  </Text>

                  {plan.description ? (
                    <Text variant="caption" tone="muted">{plan.description}</Text>
                  ) : null}

                  <Stack gap={2}>
                    {plan.maxServices != null ? (
                      <Text variant="caption" tone="muted">
                        • Up to {plan.maxServices} listing{plan.maxServices === 1 ? '' : 's'}
                      </Text>
                    ) : null}
                    {plan.features.map((feature) => (
                      <Text key={feature} variant="caption" tone="muted">• {feature}</Text>
                    ))}
                  </Stack>

                  {!isCurrent ? (
                    <Button
                      label={current ? 'Switch to this plan' : 'Choose this plan'}
                      variant={plan.priceCents === 0 ? 'secondary' : 'primary'}
                      loading={busyPlan === plan.code}
                      onPress={() => void subscribe(plan.code)}
                    />
                  ) : null}
                </Stack>
              </Card>
            );
          })
        )}
      </Stack>

      {current?.payments.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Payment history" />
          <Card padded={false}>
            {current.payments.map((payment, index) => (
              <View key={`${payment.createdAt}-${index}`}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <ListRow
                  title={formatMoney(payment.amountCents, payment.currency)}
                  subtitle={payment.status}
                  meta={formatDate(payment.paidAt ?? payment.createdAt)}
                />
              </View>
            ))}
          </Card>
        </Stack>
      ) : null}

      {current && !current.cancelAtPeriodEnd ? (
        <Button
          label="Cancel my plan"
          variant="secondary"
          onPress={() => setConfirmCancel(true)}
        />
      ) : null}

      <ConfirmSheet
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel your plan?"
        message={
          current?.currentPeriodEnd
            ? `You keep everything until ${formatDate(current.currentPeriodEnd)}. After that your listings stop appearing in search — your clients, jobs and invoices all stay.`
            : 'You keep everything until the end of the current period. After that your listings stop appearing in search — your clients, jobs and invoices all stay.'
        }
        confirmLabel="Cancel at period end"
        busy={cancel.isPending}
        onConfirm={() => void endPlan()}
      />
    </ScreenScroll>
  );
}
