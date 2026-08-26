import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Shell } from '../../components/Shell';
import { CUSTOMER_TABS, PROVIDER_TABS } from '../../components/nav';
import { Icon } from '../../components/Icon';
import {
  Button, StatusPill, SkeletonList, ErrorState, ConfirmDialog, Banner, Modal, TextArea,
} from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { api, ApiError, newIdempotencyKey } from '../../lib/api';
import { useAuth } from '../../state/auth';
import { useToast } from '../../state/ui';
import { formatMoney, formatDate } from '../../lib/format';

export interface DocumentLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  lineTotalCents: number;
}

interface QuoteDetail {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  pdfUrl: string | null;
  pdfSha256: string | null;
  job: { id: string; title: string };
  provider: { businessName: string; tagline: string | null; city: string | null; phone: string | null };
  client: { fullName: string; email?: string; phone?: string; city: string | null };
  lines: DocumentLine[];
}

export function QuoteViewScreen() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { notify } = useToast();
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const quote = useApi(() => api.get<QuoteDetail>(`/quotes/${id}`), [id]);
  const tabs = user?.role === 'provider' ? PROVIDER_TABS : CUSTOMER_TABS;

  const respond = async (decision: 'accept' | 'decline', reason?: string) => {
    setBusy(true);
    try {
      await api.post(`/quotes/${id}/respond`, { decision, reason }, newIdempotencyKey());
      notify(
        decision === 'accept'
          ? 'Quote accepted. Your provider will be in touch to schedule.'
          : 'Quote declined.',
        decision === 'accept' ? 'success' : 'default',
      );
      setConfirmAccept(false);
      setDeclineOpen(false);
      quote.reload();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'That did not work. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (quote.loading) {
    return <Shell title="Quote" tabs={tabs} back><SkeletonList rows={3} /></Shell>;
  }
  if (quote.error || !quote.data) {
    return (
      <Shell title="Quote" tabs={tabs} back>
        <ErrorState message={quote.error ?? 'Quote not found.'} onRetry={quote.reload} />
      </Shell>
    );
  }

  const q = quote.data;
  const canRespond = user?.role === 'customer' && q.status === 'sent';

  return (
    <Shell title={q.number} tabs={tabs} back>
      <DocumentSheet
        kind="Quote"
        number={q.number}
        status={q.status}
        partyLabel={user?.role === 'provider' ? 'Prepared for' : 'From'}
        partyName={user?.role === 'provider' ? q.client.fullName : q.provider.businessName}
        partyMeta={user?.role === 'provider' ? q.client.city : q.provider.city}
        dateLabel="Issued"
        dateValue={q.sentAt ?? q.createdAt}
        secondaryDateLabel={q.validUntil ? 'Valid until' : undefined}
        secondaryDateValue={q.validUntil}
        lines={q.lines}
        currency={q.currency}
        subtotalCents={q.subtotalCents}
        discountCents={q.discountCents}
        taxCents={q.taxCents}
        totalCents={q.totalCents}
        notes={q.notes}
        terms={q.terms}
        pdfUrl={q.pdfUrl}
        pdfSha256={q.pdfSha256}
      />

      {q.status === 'accepted' && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <Banner tone="success" icon="check">
            Accepted on {formatDate(q.acceptedAt)}. The job is approved and ready to schedule.
          </Banner>
        </div>
      )}

      {q.status === 'declined' && (
        <div style={{ marginTop: 'var(--s4)' }}>
          <Banner tone="warning">Declined on {formatDate(q.declinedAt)}.</Banner>
        </div>
      )}

      {canRespond && (
        <div className="row" style={{ gap: 'var(--s3)', marginTop: 'var(--s5)' }}>
          <Button variant="secondary" block onClick={() => setDeclineOpen(true)}>Decline</Button>
          <Button block icon="check" onClick={() => setConfirmAccept(true)}>Accept quote</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmAccept}
        title="Accept this quote?"
        body={`You are agreeing to ${formatMoney(q.totalCents, q.currency)} for "${q.job.title}". The provider will then schedule the work.`}
        confirmLabel="Accept quote"
        loading={busy}
        onConfirm={() => respond('accept')}
        onCancel={() => setConfirmAccept(false)}
      />

      <DeclineModal
        open={declineOpen}
        busy={busy}
        onCancel={() => setDeclineOpen(false)}
        onConfirm={(reason) => respond('decline', reason)}
      />
    </Shell>
  );
}

function DeclineModal({
  open, busy, onCancel, onConfirm,
}: { open: boolean; busy: boolean; onCancel: () => void; onConfirm: (reason?: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} title="Decline this quote?" onClose={onCancel}>
      <p className="modal__body">
        Letting the provider know why helps them send a better quote next time. This is optional.
      </p>
      <TextArea
        label="Reason (optional)"
        placeholder="The price is higher than I budgeted for."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
      />
      <div className="modal__actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Keep it open</Button>
        <Button variant="danger" onClick={() => onConfirm(reason.trim() || undefined)} loading={busy}>
          Decline
        </Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------- shared document --- */

interface DocumentSheetProps {
  kind: string;
  number: string;
  status: string;
  partyLabel: string;
  partyName: string;
  partyMeta?: string | null;
  dateLabel: string;
  dateValue: string | null;
  secondaryDateLabel?: string;
  secondaryDateValue?: string | null;
  lines: DocumentLine[];
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents?: number;
  notes?: string | null;
  terms?: string | null;
  pdfUrl: string | null;
  pdfSha256?: string | null;
}

export function DocumentSheet(props: DocumentSheetProps) {
  const money = (cents: number) => formatMoney(cents, props.currency);
  const balance = props.amountPaidCents !== undefined
    ? props.totalCents - props.amountPaidCents
    : null;

  return (
    <article className="doc-sheet">
      <header className="doc-sheet__header">
        <div className="row row--between">
          <div>
            <div className="doc-sheet__kind">{props.kind}</div>
            <div className="doc-sheet__number">{props.number}</div>
          </div>
          <StatusPill status={props.status} />
        </div>
      </header>

      <div className="doc-sheet__body">
        <div className="row row--between" style={{ marginBottom: 'var(--s4)', alignItems: 'flex-start' }}>
          <div>
            <div className="tiny subtle">{props.partyLabel.toUpperCase()}</div>
            <div className="strong">{props.partyName}</div>
            {props.partyMeta && <div className="tiny subtle">{props.partyMeta}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="tiny subtle">{props.dateLabel.toUpperCase()}</div>
            <div className="small strong">{formatDate(props.dateValue)}</div>
            {props.secondaryDateLabel && (
              <>
                <div className="tiny subtle" style={{ marginTop: 6 }}>
                  {props.secondaryDateLabel.toUpperCase()}
                </div>
                <div className="small strong">{formatDate(props.secondaryDateValue ?? null)}</div>
              </>
            )}
          </div>
        </div>

        <div>
          {props.lines.map((line, index) => (
            <div className="doc-line" key={index}>
              <div className="grow">
                <div className="doc-line__desc">{line.description}</div>
                <div className="doc-line__meta">
                  {line.quantity} × {money(line.unitPriceCents)}
                  {line.taxRateBp > 0 ? ` · ${(line.taxRateBp / 100).toFixed(0)}% tax` : ''}
                </div>
              </div>
              <div className="doc-line__amount">{money(line.lineTotalCents)}</div>
            </div>
          ))}
        </div>

        <div className="doc-totals">
          <div className="doc-total-row">
            <span>Subtotal</span><span>{money(props.subtotalCents)}</span>
          </div>
          {props.discountCents > 0 && (
            <div className="doc-total-row">
              <span>Discount</span><span>− {money(props.discountCents)}</span>
            </div>
          )}
          {props.taxCents > 0 && (
            <div className="doc-total-row">
              <span>Tax</span><span>{money(props.taxCents)}</span>
            </div>
          )}
          <div className="doc-total-row doc-total-row--grand">
            <span>Total</span>
            <span className="doc-total-row__value">{money(props.totalCents)}</span>
          </div>
          {balance !== null && props.amountPaidCents! > 0 && (
            <>
              <div className="doc-total-row">
                <span>Paid</span><span>{money(props.amountPaidCents!)}</span>
              </div>
              <div className="doc-total-row" style={{ fontWeight: 700, color: 'var(--text)' }}>
                <span>Balance due</span><span>{money(balance)}</span>
              </div>
            </>
          )}
        </div>

        {props.notes && (
          <>
            <hr className="divider" />
            <div className="tiny subtle" style={{ marginBottom: 4 }}>NOTES</div>
            <p className="small">{props.notes}</p>
          </>
        )}

        {props.terms && (
          <>
            <div className="tiny subtle" style={{ marginTop: 'var(--s4)', marginBottom: 4 }}>TERMS</div>
            <p className="small muted">{props.terms}</p>
          </>
        )}

        {props.pdfUrl && (
          <>
            <hr className="divider" />
            <a className="btn btn--secondary btn--block" href={props.pdfUrl} target="_blank" rel="noreferrer">
              <Icon name="download" size={18} /> Download PDF
            </a>
            {props.pdfSha256 && (
              <p className="tiny subtle center" style={{ marginTop: 'var(--s2)', wordBreak: 'break-all' }}>
                Document digest {props.pdfSha256.slice(0, 16)}…
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
