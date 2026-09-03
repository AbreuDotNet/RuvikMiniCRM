import { formatMoney } from '../lib/format';

export interface ReceiptData {
  receiptNumber: string;
  paymentId: string;
  paidAt: string;
  method: string;
  reference: string | null;
  currency: string;
  business: {
    name: string;
    tagline: string | null;
    addressLine: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    phone: string | null;
  };
  customerName: string;
  invoice: {
    id: string;
    number: string;
    issueDate: string;
    jobTitle: string | null;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    taxableBaseCents: number;
    untaxedBaseCents: number;
    taxJurisdiction: string | null;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    taxTreatment: 'taxable' | 'exempt' | 'not_subject';
    taxReason: string | null;
    lineTaxCents: number;
  }>;
  amountPaidCents: number;
  paidToDateCents: number;
  balanceCents: number;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'CASH',
  card: 'CARD',
  transfer: 'BANK TRANSFER',
  manual: 'MANUAL ENTRY',
  other: 'OTHER',
};

/**
 * Date and time exactly as the till saw them.
 *
 * Deliberately the viewer's local zone: the receipt is handed over in a shop,
 * and a customer comparing it to their phone clock must see the same time. The
 * ISO instant is what the server stores; this is only its presentation.
 */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface ReceiptProps {
  data: ReceiptData;
  /** Roll width. 80mm is the common POS size; 58mm is the handheld one. */
  paper?: '80mm' | '58mm';
}

/**
 * One payment receipt, laid out for a thermal roll.
 *
 * Every figure comes from the server. The component formats and never
 * computes — a slip that reached its own total would be a second source of
 * truth for money, and the one in the customer's hand is the one that gets
 * argued about.
 */
export function Receipt({ data, paper = '80mm' }: ReceiptProps) {
  const money = (cents: number) => formatMoney(cents, data.currency);
  const { business: biz, invoice } = data;

  const cityLine = [biz.city, biz.region, biz.postalCode].filter(Boolean).join(', ');
  // A partial payment must not look like a settled bill.
  const settled = data.balanceCents === 0;

  return (
    <div className={`receipt${paper === '58mm' ? ' receipt--58' : ''}`}>
      <div className="receipt__center">
        <div className="receipt__business">{biz.name}</div>
        {biz.tagline && <div>{biz.tagline}</div>}
        {biz.addressLine && <div>{biz.addressLine}</div>}
        {cityLine && <div>{cityLine}</div>}
        {biz.phone && <div>{biz.phone}</div>}
      </div>

      <hr className="receipt__rule" />

      <div className="receipt__center">
        <strong>PAYMENT RECEIPT</strong>
      </div>
      <div className="receipt__row"><span>Receipt</span><span>{data.receiptNumber}</span></div>
      <div className="receipt__row"><span>Date</span><span>{formatStamp(data.paidAt)}</span></div>
      <div className="receipt__row"><span>Invoice</span><span>{invoice.number}</span></div>
      <div className="receipt__row"><span>Customer</span><span>{data.customerName}</span></div>
      {invoice.jobTitle && (
        <div className="receipt__row"><span>Job</span><span>{invoice.jobTitle}</span></div>
      )}

      <hr className="receipt__rule" />

      {data.lines.map((line, i) => (
        <div className="receipt__item" key={i}>
          <div className="receipt__item-desc">{line.description}</div>
          <div className="receipt__row">
            <span className="receipt__item-note">
              {line.quantity} x {money(line.unitPriceCents)}
            </span>
            <span>{money(line.lineTotalCents)}</span>
          </div>
          {line.taxTreatment !== 'taxable' && line.taxReason && (
            <div className="receipt__item-note">
              * {line.taxTreatment === 'exempt' ? 'Exempt' : 'No sales tax'}
            </div>
          )}
        </div>
      ))}

      <hr className="receipt__rule" />

      <div className="receipt__row"><span>Subtotal</span><span>{money(invoice.subtotalCents)}</span></div>
      {invoice.discountCents > 0 && (
        <div className="receipt__row">
          <span>Discount</span><span>-{money(invoice.discountCents)}</span>
        </div>
      )}
      {invoice.untaxedBaseCents > 0 && (
        <>
          <div className="receipt__row">
            <span>Taxable</span><span>{money(invoice.taxableBaseCents)}</span>
          </div>
          <div className="receipt__row">
            <span>Non-taxable</span><span>{money(invoice.untaxedBaseCents)}</span>
          </div>
        </>
      )}
      <div className="receipt__row">
        <span>Sales tax{invoice.taxJurisdiction ? ` (${invoice.taxJurisdiction})` : ''}</span>
        <span>{invoice.taxCents > 0 ? money(invoice.taxCents) : 'None'}</span>
      </div>

      <hr className="receipt__rule receipt__rule--solid" />

      <div className="receipt__row receipt__total">
        <span>INVOICE TOTAL</span><span>{money(invoice.totalCents)}</span>
      </div>

      <hr className="receipt__rule" />

      <div className="receipt__row receipt__total">
        <span>PAID NOW</span><span>{money(data.amountPaidCents)}</span>
      </div>
      <div className="receipt__row">
        <span>Method</span><span>{METHOD_LABELS[data.method] ?? data.method.toUpperCase()}</span>
      </div>
      {data.reference && (
        <div className="receipt__row"><span>Reference</span><span>{data.reference}</span></div>
      )}

      {/* Only shown when it tells the customer something they do not already
          know from the line above: a first full payment needs neither. */}
      {data.paidToDateCents !== data.amountPaidCents && (
        <div className="receipt__row">
          <span>Paid to date</span><span>{money(data.paidToDateCents)}</span>
        </div>
      )}
      <div className="receipt__row receipt__total">
        <span>{settled ? 'BALANCE' : 'BALANCE DUE'}</span>
        <span>{money(data.balanceCents)}</span>
      </div>

      <hr className="receipt__rule" />

      <div className="receipt__thanks">
        {settled ? (
          <>
            <div><strong>PAID IN FULL</strong></div>
            <div>Thank you for your business!</div>
          </>
        ) : (
          <>
            <div><strong>PART PAYMENT</strong></div>
            <div>Thank you — {money(data.balanceCents)} remains due.</div>
          </>
        )}
        <div>&nbsp;</div>
        <div>{invoice.number} · {data.receiptNumber}</div>
      </div>

      {/* Blank feed so the cutter does not slice through the last line. */}
      <div className="receipt__feed" />
    </div>
  );
}
