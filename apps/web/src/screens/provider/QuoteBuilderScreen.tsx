import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, TextField, TextArea, PickerField, StatusPill, Banner, SkeletonList,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatMoney } from '../../lib/format';
import { computeTotals, type TaxTreatment } from '../../lib/money';

/** Wording the provider picks from, so a relieved line is never left unexplained. */
const TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxable: 'Taxable',
  exempt: 'Exempt (certificate on file)',
  not_subject: 'Not subject to sales tax',
};

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  taxTreatment: TaxTreatment;
  taxReason: string;
}

interface JobOption {
  id: string;
  reference: string;
  title: string;
  status: string;
  city: string | null;
  client: { fullName: string };
}

/**
 * No default rate. There is no national US sales tax and no rate that is
 * right everywhere, so the provider's configured rate is filled in when the
 * screen loads and a blank stays blank rather than inventing a figure.
 */
const newLine = (defaultRate: string): DraftLine => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '',
  taxRate: defaultRate,
  taxTreatment: 'taxable',
  taxReason: '',
});

/**
 * Preview totals, reached through the same module the API uses. This screen
 * used to carry its own arithmetic and it did not agree with the server: the
 * API rounded tax per line, this rounded the aggregate, and a discount moved
 * the tax by a cent between what the provider approved and what was invoiced.
 */
function computePreview(lines: DraftLine[], discountValue: string) {
  return computeTotals(
    lines.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitPriceCents: Math.round((Number(l.unitPrice) || 0) * 100),
      taxRateBp: Math.round((Number(l.taxRate) || 0) * 100),
      taxTreatment: l.taxTreatment,
    })),
    Math.round((Number(discountValue) || 0) * 100),
  );
}

export function QuoteBuilderScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();

  const preselectedJob = params.get('job') ?? '';

  // The provider's configured rate. Empty until it loads, and empty is a
  // legitimate answer: five states levy no general sales tax at all.
  const taxSettings = useApi(
    () => api.get<{ taxState: string | null; defaultTaxRateBp: number }>('/provider/tax-settings'),
    [],
  );
  const defaultRate = taxSettings.data ? String(taxSettings.data.defaultTaxRateBp / 100) : '';

  const [jobId, setJobId] = useState(preselectedJob);
  const [lines, setLines] = useState<DraftLine[]>([newLine('')]);
  const [discount, setDiscount] = useState('');
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date(Date.now() + 14 * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('Thank you for the opportunity to quote for this work.');
  const [terms, setTerms] = useState('Quote valid for 14 days. Payment due within 14 days of invoice.');
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobs = useApi(
    () => api.get<{ data: JobOption[] }>('/provider/jobs', { limit: 50 }),
    [],
  );

  const totals = useMemo(() => computePreview(lines, discount), [lines, discount]);

  // Fill the rate in once it arrives, without overwriting anything typed.
  useEffect(() => {
    if (!defaultRate) return;
    setLines((current) =>
      current.map((l) => (l.taxRate === '' ? { ...l, taxRate: defaultRate } : l)));
  }, [defaultRate]);

  const updateLine = (key: string, field: keyof Omit<DraftLine, 'key'>, value: string) => {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };

  const removeLine = (key: string) => {
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)));
  };

  const validate = (): string | null => {
    if (!jobId) return 'Choose the job this quote is for.';
    const filled = lines.filter((l) => l.description.trim() && Number(l.unitPrice) > 0);
    if (!filled.length) return 'Add at least one line item with a description and price.';
    return null;
  };

  const submit = async (send: boolean) => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(send ? 'send' : 'save');
    setError(null);

    try {
      const payload = {
        jobId,
        lines: lines
          .filter((l) => l.description.trim() && Number(l.unitPrice) > 0)
          .map((l) => ({
            description: l.description.trim(),
            quantity: Number(l.quantity) || 1,
            unitPriceCents: Math.round(Number(l.unitPrice) * 100),
            taxRateBp: Math.round((Number(l.taxRate) || 0) * 100),
            taxTreatment: l.taxTreatment,
            taxReason: l.taxTreatment === 'taxable' ? undefined : l.taxReason.trim(),
          })),
        discountCents: Math.round((Number(discount) || 0) * 100),
        validUntil: validUntil || undefined,
        notes: notes.trim() || undefined,
        terms: terms.trim() || undefined,
      };

      const created = await api.post<{ id: string; number: string }>(
        '/quotes', payload, newIdempotencyKey(),
      );

      if (send) {
        await api.post(`/quotes/${created.id}/send`, {}, newIdempotencyKey());
        notify(`${created.number} sent to your customer.`, 'success');
      } else {
        notify(`${created.number} saved as a draft.`, 'success');
      }

      navigate(`/quotes/${created.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We could not save this quote.');
      setBusy(null);
    }
  };

  return (
    <Shell title="New quote" tabs={PROVIDER_TABS} back>

      {error && <div className="mb-4"><Banner tone="danger">{error}</Banner></div>}

      {jobs.loading ? (
        <SkeletonList rows={1} />
      ) : (
        <PickerField
          label="Job"
          hint="The client and their details come from the job."
          value={jobId}
          placeholder="Choose a job…"
          searchPlaceholder="Search by reference, job or client…"
          emptyText="No jobs yet — create one first."
          onChange={setJobId}
          options={(jobs.data?.data ?? []).map((job) => ({
            value: job.id,
            label: job.reference,
            description: job.title,
            meta: job.city ? `${job.client.fullName} · ${job.city}` : job.client.fullName,
            badge: <StatusPill status={job.status} />,
            keywords: job.status,
          }))}
        />
      )}

      <section className="mb-5">
        <div className="section__head">
          <h3 className="section__title">Line items</h3>
          <button
            type="button"
            className="section__link"
            onClick={() => setLines((current) => [...current, newLine(defaultRate)])}
          >
            + Add line
          </button>
        </div>

        {lines.map((line, index) => (
          <div className="line-editor" key={line.key}>
            <div className="line-editor__head">
              <span className="line-editor__index">ITEM {index + 1}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="line-editor__remove"
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remove item ${index + 1}`}
                >
                  Remove
                </button>
              )}
            </div>

            <input
              className="input mb-2"
              placeholder="Description of the work"
              value={line.description}
              onChange={(e) => updateLine(line.key, 'description', e.target.value)}
              aria-label={`Item ${index + 1} description`}
              maxLength={300}
            />

            <div className="line-editor__grid">
              <div>
                <label className="tiny subtle" htmlFor={`qty-${line.key}`}>Qty</label>
                <input
                  id={`qty-${line.key}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, 'quantity', e.target.value)}
                />
              </div>
              <div>
                <label className="tiny subtle" htmlFor={`tax-${line.key}`}>Tax %</label>
                <input
                  id={`tax-${line.key}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  value={line.taxRate}
                  onChange={(e) => updateLine(line.key, 'taxRate', e.target.value)}
                />
              </div>
              <div>
                <label className="tiny subtle" htmlFor={`price-${line.key}`}>Unit price</label>
                <input
                  id={`price-${line.key}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, 'unitPrice', e.target.value)}
                />
              </div>
            </div>

            <div className="mt-2">
              <label className="tiny subtle" htmlFor={`treatment-${line.key}`}>Tax treatment</label>
              <select
                id={`treatment-${line.key}`}
                className="select"
                value={line.taxTreatment}
                onChange={(e) => updateLine(line.key, 'taxTreatment', e.target.value)}
              >
                {(Object.keys(TREATMENT_LABELS) as TaxTreatment[]).map((t) => (
                  <option key={t} value={t}>{TREATMENT_LABELS[t]}</option>
                ))}
              </select>
            </div>

            {line.taxTreatment !== 'taxable' && (
              <div className="mt-2">
                <label className="tiny subtle" htmlFor={`reason-${line.key}`}>
                  Why is this line not taxed?
                </label>
                <input
                  id={`reason-${line.key}`}
                  className="input"
                  placeholder={line.taxTreatment === 'exempt'
                    ? 'e.g. resale certificate on file'
                    : 'e.g. labour on residential real property'}
                  value={line.taxReason}
                  onChange={(e) => updateLine(line.key, 'taxReason', e.target.value)}
                  maxLength={200}
                  aria-invalid={line.taxReason.trim() ? undefined : true}
                />
                <span className="tiny subtle">
                  Kept with the line and shown on the invoice — an unexplained untaxed line is
                  what an audit asks about.
                </span>
              </div>
            )}
          </div>
        ))}
      </section>

      <div className="card card--pad mb-5">
        <div className="doc-total-row">
          <span>Subtotal</span><span>{formatMoney(totals.subtotalCents)}</span>
        </div>
        {totals.discountCents > 0 && (
          <div className="doc-total-row"><span>Discount</span><span>− {formatMoney(totals.discountCents)}</span></div>
        )}
        {totals.untaxedBaseCents > 0 && (
          <>
            <div className="doc-total-row">
              <span>Taxable amount</span><span>{formatMoney(totals.taxableBaseCents)}</span>
            </div>
            <div className="doc-total-row">
              <span>Non-taxable amount</span><span>{formatMoney(totals.untaxedBaseCents)}</span>
            </div>
          </>
        )}
        <div className="doc-total-row">
          <span>Sales tax{taxSettings.data?.taxState ? ` (${taxSettings.data.taxState})` : ''}</span>
          <span>{formatMoney(totals.taxCents)}</span>
        </div>
        <div className="doc-total-row doc-total-row--grand">
          <span>Total</span>
          <span className="doc-total-row__value">{formatMoney(totals.totalCents)}</span>
        </div>
      </div>

      {/* Sales tax is a state matter and this app does not decide it. Saying so
          where the provider sets the rate is more useful than a page of terms. */}
      <p className="tiny subtle mb-5">
        Sales tax is charged at the rate you set for your jurisdiction. Whether a job is
        taxable — and whether labour is treated differently from materials — depends on your
        state and the type of property. Check with your state tax authority or a CPA.
        This total covers sales tax only; income and self-employment tax are separate and
        are never withheld here.
      </p>

      <TextField
        label="Discount (optional)"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={discount}
        onChange={(e) => setDiscount(e.target.value)}
      />

      <TextField
        label="Valid until"
        type="date"
        value={validUntil}
        onChange={(e) => setValidUntil(e.target.value)}
      />

      <TextArea
        label="Notes for the customer"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={2000}
      />

      <TextArea
        label="Terms"
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        maxLength={2000}
      />

      <div className="stack mt-5">
        <Button
          block
          size="lg"
          icon="check"
          loading={busy === 'send'}
          disabled={busy !== null}
          onClick={() => submit(true)}
        >
          Send to customer
        </Button>
        <Button
          block
          variant="secondary"
          loading={busy === 'save'}
          disabled={busy !== null}
          onClick={() => submit(false)}
        >
          Save as draft
        </Button>
      </div>

      <p className="tiny subtle center mt-4">
        <Icon name="info" size={13} /> Sending generates a branded PDF and notifies your customer
        in the app. WhatsApp is used only if they have opted in.
      </p>
    </Shell>
  );
}
