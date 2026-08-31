import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, TextField, TextArea, SelectField, Banner, SkeletonList,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useToast } from '../../state/ui';
import { formatMoney } from '../../lib/format';

interface DraftLine {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

interface JobOption {
  id: string;
  reference: string;
  title: string;
  client: { fullName: string };
}

const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '',
  taxRate: '18',
});

/**
 * Mirrors the server's money maths so the provider sees the same total the
 * API will compute. The server remains the authority — this is only preview.
 */
function computePreview(lines: DraftLine[], discountValue: string) {
  let subtotal = 0;
  let taxBeforeDiscount = 0;

  for (const line of lines) {
    const quantity = Number(line.quantity) || 0;
    const unit = Math.round((Number(line.unitPrice) || 0) * 100);
    const lineSubtotal = Math.round(quantity * unit);
    const taxBp = Math.round((Number(line.taxRate) || 0) * 100);
    subtotal += lineSubtotal;
    taxBeforeDiscount += Math.round((lineSubtotal * taxBp) / 10_000);
  }

  const discount = Math.min(Math.max(Math.round((Number(discountValue) || 0) * 100), 0), subtotal);
  const ratio = subtotal === 0 ? 0 : (subtotal - discount) / subtotal;
  const tax = Math.round(taxBeforeDiscount * ratio);

  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

export function QuoteBuilderScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { notify } = useToast();

  const preselectedJob = params.get('job') ?? '';

  const [jobId, setJobId] = useState(preselectedJob);
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
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
        <SelectField
          label="Job"
          hint="The client and their details come from the job."
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          options={[
            { value: '', label: 'Choose a job…' },
            ...(jobs.data?.data ?? []).map((job) => ({
              value: job.id,
              label: `${job.reference} · ${job.title} · ${job.client.fullName}`,
            })),
          ]}
        />
      )}

      <section className="mb-5">
        <div className="section__head">
          <h3 className="section__title">Line items</h3>
          <button
            type="button"
            className="section__link"
            onClick={() => setLines((current) => [...current, newLine()])}
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
          </div>
        ))}
      </section>

      <div className="card card--pad mb-5">
        <div className="doc-total-row">
          <span>Subtotal</span><span>{formatMoney(totals.subtotal)}</span>
        </div>
        {totals.discount > 0 && (
          <div className="doc-total-row"><span>Discount</span><span>− {formatMoney(totals.discount)}</span></div>
        )}
        <div className="doc-total-row"><span>Tax</span><span>{formatMoney(totals.tax)}</span></div>
        <div className="doc-total-row doc-total-row--grand">
          <span>Total</span>
          <span className="doc-total-row__value">{formatMoney(totals.total)}</span>
        </div>
      </div>

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
