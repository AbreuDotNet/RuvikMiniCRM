import { useState } from 'react';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, StatusPill, SkeletonList, ErrorState, Banner, ConfirmDialog, Pill,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';
import { useAuth } from '../../state/auth';
import { formatMoney, formatDate } from '../../lib/format';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  maxServices: number | null;
  features: string[];
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plan: { code: string; name: string; priceCents: number; currency: string; interval: string };
  payments: Array<{
    amountCents: number; currency: string; status: string;
    method: string | null; paidAt: string | null; createdAt: string;
  }>;
}

export function SubscriptionScreen() {
  const { notify } = useToast();
  const { refreshUser } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const plans = useApi(() => api.get<{ data: Plan[] }>('/billing/plans'), []);
  const current = useApi(
    () => api.get<{ subscription: Subscription | null }>('/billing/subscription'),
    [],
  );

  const subscribe = async (planCode: string) => {
    setBusy(planCode);
    try {
      const checkout = await api.post<{
        subscriptionId: string;
        checkout: { reference: string; amountCents: number; currency: string };
      }>('/billing/subscription', { planCode }, newIdempotencyKey());

      notify(
        `Checkout started for ${formatMoney(checkout.checkout.amountCents, checkout.checkout.currency)}. ` +
        'Your plan activates once payment is confirmed.',
        'success',
      );
      current.reload();
      await refreshUser();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'We could not start checkout.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await api.delete('/billing/subscription');
      notify('Your plan will end when the current period finishes.', 'default');
      setCancelOpen(false);
      current.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'We could not cancel.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sub = current.data?.subscription ?? null;

  return (
    <Shell title="Subscription" tabs={PROVIDER_TABS} back="/profile">
      {current.loading || plans.loading ? (
        <SkeletonList rows={3} />
      ) : plans.error ? (
        <ErrorState message={plans.error} onRetry={plans.reload} />
      ) : (
        <>
          {sub && (
            <div className="card card--pad" style={{ marginBottom: 'var(--s5)' }}>
              <div className="row row--between" style={{ marginBottom: 'var(--s3)' }}>
                <div>
                  <div className="tiny subtle">CURRENT PLAN</div>
                  <h2>{sub.plan.name}</h2>
                </div>
                <StatusPill status={sub.status} />
              </div>

              <div className="strong tabular" style={{ fontSize: '1.5rem', color: 'var(--accent)' }}>
                {formatMoney(sub.plan.priceCents, sub.plan.currency)}
                <span className="small muted" style={{ fontWeight: 400 }}> / {sub.plan.interval}</span>
              </div>

              {sub.currentPeriodEnd && (
                <p className="small muted" style={{ marginTop: 'var(--s2)' }}>
                  {sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on {formatDate(sub.currentPeriodEnd)}
                </p>
              )}

              {sub.status === 'pending_payment' && (
                <div style={{ marginTop: 'var(--s4)' }}>
                  <Banner tone="warning">
                    Waiting for payment confirmation. Your listings go live as soon as the
                    payment provider confirms the charge.
                  </Banner>
                </div>
              )}

              {sub.status === 'past_due' && (
                <div style={{ marginTop: 'var(--s4)' }}>
                  <Banner tone="danger">
                    Your last payment failed. Renew to keep your profile listed in search.
                  </Banner>
                </div>
              )}

              {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
                <div style={{ marginTop: 'var(--s4)' }}>
                  <Button variant="ghost" block onClick={() => setCancelOpen(true)}>
                    Cancel subscription
                  </Button>
                </div>
              )}
            </div>
          )}

          <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>
            {sub ? 'Change plan' : 'Choose a plan'}
          </h3>

          <div className="stack">
            {plans.data?.data.map((plan) => {
              const isCurrent = sub?.plan.code === plan.code && sub.status === 'active';
              return (
                <div
                  key={plan.id}
                  className="card card--pad"
                  style={isCurrent ? { borderColor: 'var(--accent)', borderWidth: 2 } : undefined}
                >
                  <div className="row row--between" style={{ marginBottom: 'var(--s2)' }}>
                    <h3>{plan.name}</h3>
                    {isCurrent && <Pill tone="accent">Current</Pill>}
                  </div>

                  <div className="strong tabular" style={{ fontSize: '1.6rem' }}>
                    {plan.priceCents === 0 ? 'Free' : formatMoney(plan.priceCents, plan.currency)}
                    {plan.priceCents > 0 && (
                      <span className="small muted" style={{ fontWeight: 400 }}> / {plan.interval}</span>
                    )}
                  </div>

                  {plan.description && (
                    <p className="small muted" style={{ marginTop: 'var(--s2)' }}>{plan.description}</p>
                  )}

                  <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--s4) 0 0' }}>
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="row small"
                        style={{ gap: 'var(--s2)', marginBottom: 'var(--s2)', alignItems: 'flex-start' }}
                      >
                        <Icon name="check" size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {!isCurrent && (
                    <div style={{ marginTop: 'var(--s4)' }}>
                      <Button
                        block
                        variant={plan.code === 'pro' ? 'primary' : 'secondary'}
                        loading={busy === plan.code}
                        disabled={busy !== null}
                        onClick={() => subscribe(plan.code)}
                      >
                        {sub ? 'Switch to this plan' : 'Choose plan'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {sub && sub.payments.length > 0 && (
            <section className="section" style={{ marginTop: 'var(--s6)' }}>
              <h3 className="section__title" style={{ marginBottom: 'var(--s3)' }}>Billing history</h3>
              <div className="list-group">
                {sub.payments.map((payment, index) => (
                  <div key={index} className="list-item" style={{ cursor: 'default' }}>
                    <div className="grow">
                      <div className="small strong tabular">
                        {formatMoney(payment.amountCents, payment.currency)}
                      </div>
                      <div className="tiny subtle">
                        {formatDate(payment.paidAt ?? payment.createdAt)}
                      </div>
                    </div>
                    <StatusPill status={payment.status === 'succeeded' ? 'paid' : payment.status} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel your subscription?"
        body="Your plan stays active until the end of the current billing period. After that your listings are hidden from search."
        confirmLabel="Cancel plan"
        danger
        loading={busy === 'cancel'}
        onConfirm={cancel}
        onCancel={() => setCancelOpen(false)}
      />
    </Shell>
  );
}
