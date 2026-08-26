import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import { StatusPill, SkeletonList, ErrorState, EmptyState } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';

interface CalendarJob {
  id: string;
  reference: string;
  title: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string | null;
  city: string | null;
  clientName: string;
}

export function CalendarScreen() {
  const navigate = useNavigate();
  const [monthOffset, setMonthOffset] = useState(0);

  const { from, to, label } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }, [monthOffset]);

  const calendar = useApi(
    () => api.get<{ data: CalendarJob[] }>('/provider/calendar', { from, to }),
    [from, to],
  );

  // Group by calendar day so the list reads as an agenda.
  const byDay = useMemo(() => {
    const groups = new Map<string, CalendarJob[]>();
    for (const job of calendar.data?.data ?? []) {
      const key = new Date(job.scheduledStart).toISOString().slice(0, 10);
      const list = groups.get(key) ?? [];
      list.push(job);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [calendar.data]);

  return (
    <Shell title="Calendar" tabs={PROVIDER_TABS} back="/dashboard">
      <div className="row row--between" style={{ marginBottom: 'var(--s4)' }}>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => setMonthOffset((m) => m - 1)}
          aria-label="Previous month"
        >
          <Icon name="back" size={16} />
        </button>
        <h2 style={{ fontSize: '1.05rem' }}>{label}</h2>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => setMonthOffset((m) => m + 1)}
          aria-label="Next month"
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>

      {calendar.loading ? (
        <SkeletonList rows={3} />
      ) : calendar.error ? (
        <ErrorState message={calendar.error} onRetry={calendar.reload} />
      ) : byDay.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nothing scheduled this month"
          body="Jobs you schedule appear here as an agenda."
        />
      ) : (
        <div className="stack stack--loose">
          {byDay.map(([day, jobs]) => (
            <section key={day}>
              <h3 className="section__title" style={{ marginBottom: 'var(--s2)' }}>
                {new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long', day: 'numeric', month: 'short',
                })}
              </h3>
              <div className="list-group">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className="list-item"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <div
                      className="avatar avatar--sm"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                    >
                      <span className="tiny strong">
                        {new Date(job.scheduledStart).toLocaleTimeString('en-US', {
                          hour: 'numeric', minute: '2-digit',
                        }).replace(' ', '')}
                      </span>
                    </div>
                    <div className="grow">
                      <div className="list-item__title truncate">{job.title}</div>
                      <div className="list-item__meta truncate">
                        {job.clientName}{job.city ? ` · ${job.city}` : ''}
                      </div>
                    </div>
                    <StatusPill status={job.status} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}
