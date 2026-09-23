import { useEffect, useState } from 'react';
import { Shell, AccountAction } from '../../components/Shell';
import { ADMIN_TABS } from '../../components/nav';
import {
  Button, Pill, SkeletonList, ErrorState, EmptyState, Modal, Banner, RefreshBar,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../state/ui';
import { useAuth } from '../../state/auth';
import { formatMoney } from '../../lib/format';

/**
 * The plan catalogue.
 *
 * This screen is the commercial model: what each tier costs, how much of the
 * product it includes, and which capabilities it unlocks. Editing it here
 * rather than in a seed file is the point — a price that needs a deploy to
 * change is a price that never gets tested.
 *
 * Two guardrails are the server's and are surfaced rather than re-implemented:
 * a plan cannot be deleted while anyone has ever subscribed to it, and the
 * last active plan cannot be retired.
 */

interface PlanLimits {
  maxClients: number | null;
  maxReceiptsPerMonth: number | null;
  maxServices: number | null;
  maxQuotesPerMonth: number | null;
  maxTeamMembers: number;
}

interface AdminPlan {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  trialDays: number;
  isActive: boolean;
  sortOrder: number;
  limits: PlanLimits;
  capabilities: string[];
  features: string[];
  subscribers: { live: number; total: number };
}

interface PlansResponse {
  data: AdminPlan[];
  knownCapabilities: string[];
  unimplementedCapabilities: string[];
}

const CAPABILITY_LABELS: Record<string, string> = {
  fiscal_reports: 'Export tax reports',
  tax_estimates: 'Estimated quarterly taxes',
  priority_support: 'Priority support',
  team_members: 'Assistants and employees',
  payment_gateway: 'Automatic payment recording',
  advanced_backup: 'Advanced cloud backup',
};

/** `null` is unlimited everywhere in the plan model. */
const limitLabel = (value: number | null) => (value === null ? 'Unlimited' : String(value));

export function AdminPlansScreen() {
  const { notify } = useToast();
  const { canAdminWrite } = useAuth();
  const plans = useApi(() => api.get<PlansResponse>('/admin/plans'), []);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Shell tabs={ADMIN_TABS} title="Plans" action={<AccountAction />}>
      {!canAdminWrite ? (
        <Banner tone="warning">
          Changing the catalogue needs a two-factor session. You can read it either way.
        </Banner>
      ) : null}

      <RefreshBar active={plans.loading} />

      {plans.loading && !plans.data ? (
        <SkeletonList rows={3} />
      ) : plans.error ? (
        <ErrorState message={plans.error} onRetry={plans.reload} />
      ) : !plans.data?.data.length ? (
        <EmptyState
          title="No plans yet"
          body="Create the first plan before anyone can sign up."
          action={<Button onClick={() => setCreating(true)} disabled={!canAdminWrite}>New plan</Button>}
        />
      ) : (
        <>
          <div className="row row--between" style={{ marginBottom: 16 }}>
            <p className="small muted">
              {plans.data.data.length} plans · {plans.data.data.filter((p) => p.isActive).length} active
            </p>
            <Button onClick={() => setCreating(true)} disabled={!canAdminWrite}>New plan</Button>
          </div>

          <div className="stack">
            {plans.data.data.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                unimplemented={plans.data!.unimplementedCapabilities}
                canEdit={canAdminWrite}
                onEdit={() => setEditing(plan)}
              />
            ))}
          </div>
        </>
      )}

      {creating || editing ? (
        <PlanEditor
          plan={editing}
          knownCapabilities={plans.data?.knownCapabilities ?? []}
          unimplemented={plans.data?.unimplementedCapabilities ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            plans.reload();
            notify('Plan saved.', 'success');
          }}
          onError={(message) => notify(message, 'error')}
        />
      ) : null}
    </Shell>
  );
}

function PlanCard({
  plan, unimplemented, canEdit, onEdit,
}: {
  plan: AdminPlan;
  unimplemented: string[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <article className="card">
      <div className="row row--between">
        <div>
          <h3 style={{ margin: 0 }}>
            {plan.name}{' '}
            <span className="small muted">({plan.code})</span>
          </h3>
          {plan.tagline ? <p className="small muted" style={{ margin: '2px 0 0' }}>{plan.tagline}</p> : null}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {plan.isActive ? <Pill tone="success">Active</Pill> : <Pill>Retired</Pill>}
          <Button variant="secondary" onClick={onEdit} disabled={!canEdit}>Edit</Button>
        </div>
      </div>

      <p className="h2" style={{ margin: '12px 0 4px' }}>
        {plan.priceCents === 0 ? 'Free' : formatMoney(plan.priceCents, plan.currency)}
        {plan.priceCents === 0 ? null : <span className="small muted"> / {plan.interval}</span>}
      </p>

      <p className="small muted">
        {/* Both numbers, because they answer different questions: who is
            paying today, and whose history would break if this were deleted. */}
        {plan.subscribers.live} on this plan now · {plan.subscribers.total} ever
      </p>

      <div className="grid grid--limits" style={{ marginTop: 12 }}>
        <Limit label="Clients" value={limitLabel(plan.limits.maxClients)} />
        <Limit label="Receipts / month" value={limitLabel(plan.limits.maxReceiptsPerMonth)} />
        <Limit label="Listings" value={limitLabel(plan.limits.maxServices)} />
        <Limit label="Quotes / month" value={limitLabel(plan.limits.maxQuotesPerMonth)} />
        <Limit label="Seats" value={String(plan.limits.maxTeamMembers)} />
      </div>

      {plan.capabilities.length ? (
        <div className="row row--wrap" style={{ gap: 6, marginTop: 12 }}>
          {plan.capabilities.map((c) => (
            <Pill key={c} tone={unimplemented.includes(c) ? 'warning' : 'neutral'}>
              {CAPABILITY_LABELS[c] ?? c}
              {/* Said out loud: the plan grants it, the product cannot do it
                  yet. Better here than in a support ticket. */}
              {unimplemented.includes(c) ? ' · not built yet' : ''}
            </Pill>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="micro muted" style={{ margin: 0 }}>{label}</p>
      <p className="strong" style={{ margin: 0 }}>{value}</p>
    </div>
  );
}

/** Empty means unlimited; the field says so rather than leaving it to guesswork. */
const toLimit = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const fromLimit = (value: number | null) => (value === null ? '' : String(value));

function PlanEditor({
  plan, knownCapabilities, unimplemented, onClose, onSaved, onError,
}: {
  plan: AdminPlan | null;
  knownCapabilities: string[];
  unimplemented: string[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const isNew = plan === null;
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [tagline, setTagline] = useState(plan?.tagline ?? '');
  const [price, setPrice] = useState(plan ? (plan.priceCents / 100).toFixed(2) : '0.00');
  const [maxClients, setMaxClients] = useState(fromLimit(plan?.limits.maxClients ?? null));
  const [maxReceipts, setMaxReceipts] = useState(fromLimit(plan?.limits.maxReceiptsPerMonth ?? null));
  const [maxServices, setMaxServices] = useState(fromLimit(plan?.limits.maxServices ?? null));
  const [maxQuotes, setMaxQuotes] = useState(fromLimit(plan?.limits.maxQuotesPerMonth ?? null));
  const [seats, setSeats] = useState(String(plan?.limits.maxTeamMembers ?? 1));
  const [capabilities, setCapabilities] = useState<string[]>(plan?.capabilities ?? []);
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBusy(false); }, [plan]);

  const toggle = (capability: string) => {
    setCapabilities((current) => (
      current.includes(capability)
        ? current.filter((c) => c !== capability)
        : [...current, capability]
    ));
  };

  const save = async () => {
    setBusy(true);
    try {
      // Cents, parsed from the dollars field. A price is money and money is
      // integers here as everywhere else.
      const priceCents = Math.round(Number(price) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 0) {
        onError('Enter a price of zero or more.');
        setBusy(false);
        return;
      }

      const body = {
        name: name.trim(),
        tagline: tagline.trim() || null,
        priceCents,
        maxClients: toLimit(maxClients),
        maxReceiptsPerMonth: toLimit(maxReceipts),
        maxServices: toLimit(maxServices),
        maxQuotesPerMonth: toLimit(maxQuotes),
        maxTeamMembers: Math.max(1, Math.trunc(Number(seats) || 1)),
        capabilities,
        isActive,
      };

      if (isNew) await api.post('/admin/plans', { ...body, code: code.trim() });
      else await api.patch(`/admin/plans/${plan!.id}`, body);

      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'We could not save that plan.');
      setBusy(false);
    }
  };

  return (
    <Modal open title={isNew ? 'New plan' : `Edit ${plan!.name}`} onClose={onClose}>
      <div className="stack">
        {isNew ? (
          <Field label="Code" hint="Lowercase, no spaces. Permanent once created.">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="pro" />
          </Field>
        ) : (
          <Banner tone="info">
            The code <code>{plan!.code}</code> cannot change: subscriptions and any payment
            provider reference it.
          </Banner>
        )}

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro" />
        </Field>

        <Field label="Tagline">
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="For the working professional."
          />
        </Field>

        <Field label="Price per month" hint="In dollars. Zero means free.">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
        </Field>

        <h4 style={{ margin: '8px 0 0' }}>Allowances</h4>
        <p className="small muted" style={{ marginTop: 0 }}>
          Leave a field empty for unlimited.
        </p>

        <Field label="Clients">
          <input value={maxClients} onChange={(e) => setMaxClients(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Receipts per month">
          <input value={maxReceipts} onChange={(e) => setMaxReceipts(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Listings">
          <input value={maxServices} onChange={(e) => setMaxServices(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Quotes per month">
          <input value={maxQuotes} onChange={(e) => setMaxQuotes(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Seats" hint="How many people can sign in on this account. Minimum one.">
          <input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" />
        </Field>

        <h4 style={{ margin: '8px 0 0' }}>Capabilities</h4>
        <div className="stack" style={{ gap: 6 }}>
          {knownCapabilities.map((capability) => (
            <label key={capability} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={() => toggle(capability)}
              />
              <span>
                {CAPABILITY_LABELS[capability] ?? capability}
                {unimplemented.includes(capability) ? (
                  <span className="small muted"> · not built yet</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>

        <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Offered to new subscribers</span>
        </label>
        <p className="small muted" style={{ marginTop: 0 }}>
          Retiring a plan hides it from signup. Anyone already on it stays on it, at the price
          they agreed.
        </p>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <Button onClick={() => void save()} loading={busy}>
            {isNew ? 'Create plan' : 'Save changes'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="small muted">{label}</span>
      {children}
      {hint ? <span className="micro muted">{hint}</span> : null}
    </label>
  );
}
