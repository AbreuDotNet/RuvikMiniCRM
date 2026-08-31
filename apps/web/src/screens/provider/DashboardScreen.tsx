import { useNavigate } from 'react-router-dom';
import { Shell, BellAction } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Section, SkeletonList, ErrorState, EmptyState, Banner, StatusPill, Button,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { formatMoney, formatMoneyCompact, formatDateTime } from '../../lib/format';

interface Dashboard {
  newLeads: number;
  upcomingJobs: number;
  jobsByStatus: Record<string, number>;
  outstandingCents: number;
  overdueCents: number;
  monthlyActivity: Array<{ month: string; completed: number; revenueCents: number }>;
  upcomingSchedule: Array<{
    id: string; reference: string; title: string;
    scheduledStart: string | null; status: string; clientName: string;
  }>;
  subscription: {
    status: string; planName: string; priceCents: number;
    currency: string; currentPeriodEnd: string | null;
  } | null;
}

export function ProviderDashboardScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const dashboard = useApi(() => api.get<Dashboard>('/provider/dashboard'), []);
  const notifications = useApi(
    () => api.get<{ unreadCount: number }>('/notifications', { limit: 1 }),
    [],
  );

  return (
    <Shell
      title="Dashboard"
      tabs={PROVIDER_TABS}
      action={<BellAction unread={notifications.data?.unreadCount ?? 0} />}
    >
      {dashboard.loading ? (
        <SkeletonList rows={4} />
      ) : dashboard.error || !dashboard.data ? (
        <ErrorState message={dashboard.error ?? 'Could not load your dashboard.'} onRetry={dashboard.reload} />
      ) : (
        <>
          {user?.providerStatus === 'unverified' && (
            <div className="mb-4">
              <Banner tone="warning">
                Your business is not verified yet. Complete your profile to request verification —
                verified providers get noticeably more requests.
              </Banner>
            </div>
          )}

          {dashboard.data.subscription?.status === 'past_due' && (
            <div className="mb-4">
              <Banner tone="danger">
                Your subscription payment failed. Update your billing details to stay listed.
              </Banner>
            </div>
          )}

          <div className="stat-grid mb-5">
            <button
              type="button"
              className="stat-tile stat-tile--brand"
              onClick={() => navigate('/jobs?status=new_lead')}
            >
              <span className="stat-tile__value">{dashboard.data.newLeads}</span>
              <span className="stat-tile__label">New Leads</span>
            </button>
            <button
              type="button"
              className="stat-tile stat-tile--sage"
              onClick={() => navigate('/jobs?status=scheduled')}
            >
              <span className="stat-tile__value">{dashboard.data.upcomingJobs}</span>
              <span className="stat-tile__label">Upcoming Jobs</span>
            </button>
          </div>

          <button
            type="button"
            className="card card--pad"
            onClick={() => navigate('/invoices')}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              cursor: 'pointer', marginBottom: 'var(--s5)',
            }}
          >
            <div className="row row--between">
              <div>
                <div className="stat-tile__label">Outstanding invoices</div>
                <div
                  className="stat-tile__value tabular"
                  style={{ color: 'var(--accent)', marginTop: 4 }}
                >
                  {formatMoney(dashboard.data.outstandingCents)}
                </div>
              </div>
              <Icon name="chevron" size={20} className="subtle" />
            </div>
            {dashboard.data.overdueCents > 0 && (
              <div className="mt-3">
                <Banner tone="danger">
                  {formatMoney(dashboard.data.overdueCents)} is overdue.
                </Banner>
              </div>
            )}
          </button>

          <Section title="Monthly activity">
            <div className="card card--pad">
              {dashboard.data.monthlyActivity.length === 0 ? (
                <p className="small subtle center" style={{ padding: 'var(--s5) 0' }}>
                  Complete your first job to start seeing activity here.
                </p>
              ) : (
                <ActivityChart data={dashboard.data.monthlyActivity} />
              )}
            </div>
          </Section>

          <Section
            title="Upcoming schedule"
            action={
              <button type="button" className="section__link" onClick={() => navigate('/calendar')}>
                Calendar
              </button>
            }
          >
            {dashboard.data.upcomingSchedule.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Nothing scheduled"
                body="Approved jobs you schedule will appear here."
                action={<Button variant="secondary" onClick={() => navigate('/jobs')}>View jobs</Button>}
              />
            ) : (
              <div className="list-group">
                {dashboard.data.upcomingSchedule.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="list-item"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <div className="avatar avatar--sm" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                      <Icon name="calendar" size={16} />
                    </div>
                    <div className="grow">
                      <div className="list-item__title truncate">{job.title}</div>
                      <div className="list-item__meta truncate">
                        {job.clientName} · {formatDateTime(job.scheduledStart)}
                      </div>
                    </div>
                    <StatusPill status={job.status} />
                  </button>
                ))}
              </div>
            )}
          </Section>

          {dashboard.data.subscription && (
            <Section title="Subscription">
              <button
                type="button"
                className="card-button"
                onClick={() => navigate('/subscription')}
              >
                <div className="row row--between">
                  <div>
                    <div className="strong">{dashboard.data.subscription.planName} plan</div>
                    <div className="small muted">
                      {formatMoney(dashboard.data.subscription.priceCents, dashboard.data.subscription.currency)} / month
                    </div>
                  </div>
                  <StatusPill status={dashboard.data.subscription.status} />
                </div>
              </button>
            </Section>
          )}
        </>
      )}
    </Shell>
  );
}

/**
 * Six-month activity chart. Bars are scaled against the busiest month so a
 * quiet period still shows a readable shape.
 */
function ActivityChart({ data }: { data: Dashboard['monthlyActivity'] }) {
  const max = Math.max(...data.map((d) => d.completed), 1);
  const totalRevenue = data.reduce((sum, d) => sum + d.revenueCents, 0);

  return (
    <>
      <div className="row row--between mb-2">
        <span className="tiny subtle">Completed jobs</span>
        <span className="small strong tabular">{formatMoneyCompact(totalRevenue)} collected</span>
      </div>

      <div className="bar-chart" role="img" aria-label={
        data.map((d) => `${d.month}: ${d.completed} completed`).join(', ')
      }>
        {data.map((month) => (
          <div className="bar-chart__col" key={month.month}>
            <div
              className="bar-chart__bar"
              style={{ height: `${Math.max(6, (month.completed / max) * 100)}%` }}
            />
            <span className="bar-chart__label">{month.month.slice(5)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
