import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { formatMoney } from './money.js';

/** Ruvik brand palette, kept in sync with the app theme. */
const BRAND = {
  ink: '#1B2A3A',
  slate: '#3C5A7D',
  terracotta: '#C4623F',
  muted: '#6B7C8F',
  hairline: '#DCE3EA',
  panel: '#F4F6F8',
};

export interface DocumentParty {
  name: string;
  email?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  city?: string | null;
}

export interface DocumentLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  lineTotalCents: number;
  taxTreatment?: 'taxable' | 'exempt' | 'not_subject';
  /** Printed beneath the line when no tax was charged. */
  taxReason?: string | null;
}

export interface RenderDocumentInput {
  kind: 'quote' | 'invoice';
  number: string;
  currency: string;
  issueDate: string;
  dueDate?: string | null;
  validUntil?: string | null;
  status: string;
  from: DocumentParty & { tagline?: string | null };
  to: DocumentParty;
  lines: DocumentLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Portion of the discounted subtotal sales tax was charged on. */
  taxableBaseCents?: number;
  /** Portion carrying no tax, exempt or out of scope. */
  untaxedBaseCents?: number;
  /** Two-letter state the document was priced under, if recorded. */
  taxJurisdiction?: string | null;
  amountPaidCents?: number;
  notes?: string | null;
  terms?: string | null;
  /** Rendered into the footer so a printed copy can be checked against the API. */
  verificationUrl?: string | null;
}

export interface RenderedDocument {
  buffer: Buffer;
  sha256: string;
}

/**
 * Renders a branded quote/invoice PDF.
 *
 * Tamper-resistance: the returned SHA-256 is stored alongside the file and
 * printed in the footer. Any later edit produces a different digest, so a
 * forwarded or altered PDF can be checked against the record on file.
 */
export async function renderDocument(input: RenderDocumentInput): Promise<RenderedDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `${input.kind === 'quote' ? 'Quote' : 'Invoice'} ${input.number}`,
    Author: input.from.name,
    Creator: 'Ruvik',
  } });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const money = (cents: number) => formatMoney(cents, input.currency);
  const pageWidth = doc.page.width - 96;
  const left = 48;
  const right = doc.page.width - 48;

  /* ------------------------------- header -------------------------------- */
  doc.rect(0, 0, doc.page.width, 118).fill(BRAND.slate);
  doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold')
     .text(input.from.name, left, 34, { width: pageWidth * 0.6 });
  if (input.from.tagline) {
    doc.fontSize(9).font('Helvetica').fillColor('#D6E0EA')
       .text(input.from.tagline, left, 64, { width: pageWidth * 0.6 });
  }
  doc.fontSize(26).font('Helvetica-Bold').fillColor('#FFFFFF')
     .text(input.kind === 'quote' ? 'QUOTE' : 'INVOICE', left, 34, {
       width: pageWidth, align: 'right',
     });
  doc.fontSize(11).font('Helvetica').fillColor('#E8EEF4')
     .text(input.number, left, 66, { width: pageWidth, align: 'right' });

  const statusLabel = input.status.replace(/_/g, ' ').toUpperCase();
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF')
     .text(statusLabel, left, 86, { width: pageWidth, align: 'right' });

  /* ------------------------------- parties ------------------------------- */
  let y = 146;
  const colW = pageWidth / 2 - 12;

  doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND.muted).text('FROM', left, y);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(BRAND.ink).text(input.from.name, left, y + 14);
  doc.fontSize(9).font('Helvetica').fillColor(BRAND.muted);
  let fy = y + 30;
  for (const line of [input.from.addressLine, input.from.city, input.from.phone, input.from.email]) {
    if (line) { doc.text(line, left, fy, { width: colW }); fy += 12; }
  }

  const rx = left + colW + 24;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND.muted).text('BILL TO', rx, y);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(BRAND.ink).text(input.to.name, rx, y + 14);
  doc.fontSize(9).font('Helvetica').fillColor(BRAND.muted);
  let ty = y + 30;
  for (const line of [input.to.addressLine, input.to.city, input.to.phone, input.to.email]) {
    if (line) { doc.text(line, rx, ty, { width: colW }); ty += 12; }
  }

  y = Math.max(fy, ty) + 14;

  /* -------------------------------- dates -------------------------------- */
  doc.rect(left, y, pageWidth, 30).fill(BRAND.panel);
  doc.fontSize(9).font('Helvetica').fillColor(BRAND.muted);
  doc.text(`Issued  ${input.issueDate}`, left + 12, y + 11);
  if (input.dueDate) doc.text(`Due  ${input.dueDate}`, left + 180, y + 11);
  if (input.validUntil) doc.text(`Valid until  ${input.validUntil}`, left + 180, y + 11);
  y += 48;

  /* ----------------------------- line items ------------------------------ */
  const cols = {
    desc: left,
    qty: left + pageWidth * 0.54,
    unit: left + pageWidth * 0.66,
    tax: left + pageWidth * 0.80,
    total: left,
  };

  doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND.muted);
  doc.text('DESCRIPTION', cols.desc, y);
  doc.text('QTY', cols.qty, y, { width: 40, align: 'right' });
  doc.text('UNIT', cols.unit, y, { width: 70, align: 'right' });
  doc.text('TAX', cols.tax, y, { width: 36, align: 'right' });
  doc.text('AMOUNT', cols.total, y, { width: pageWidth, align: 'right' });
  y += 14;
  doc.moveTo(left, y).lineTo(right, y).strokeColor(BRAND.hairline).lineWidth(1).stroke();
  y += 10;

  doc.fontSize(9.5).font('Helvetica').fillColor(BRAND.ink);
  for (const line of input.lines) {
    if (y > doc.page.height - 190) {
      doc.addPage();
      y = 60;
    }
    const descHeight = doc.heightOfString(line.description, { width: pageWidth * 0.5 });
    doc.fillColor(BRAND.ink).text(line.description, cols.desc, y, { width: pageWidth * 0.5 });
    doc.fillColor(BRAND.muted);
    doc.text(String(line.quantity), cols.qty, y, { width: 40, align: 'right' });
    doc.text(money(line.unitPriceCents), cols.unit, y, { width: 70, align: 'right' });
    doc.text(`${(line.taxRateBp / 100).toFixed(0)}%`, cols.tax, y, { width: 36, align: 'right' });
    doc.fillColor(BRAND.ink).font('Helvetica-Bold')
       .text(money(line.lineTotalCents), cols.total, y, { width: pageWidth, align: 'right' });
    doc.font('Helvetica');
    y += Math.max(descHeight, 12) + 10;
  }

  /* ------------------------------- totals -------------------------------- */
  y += 6;
  doc.moveTo(left + pageWidth * 0.55, y).lineTo(right, y).strokeColor(BRAND.hairline).stroke();
  y += 12;

  const totalRow = (label: string, value: string, bold = false, color = BRAND.ink) => {
    doc.fontSize(bold ? 12 : 9.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(BRAND.muted)
       .text(label, left + pageWidth * 0.55, y, { width: pageWidth * 0.25, align: 'right' });
    doc.fillColor(color)
       .text(value, left, y, { width: pageWidth, align: 'right' });
    y += bold ? 22 : 16;
  };

  totalRow('Subtotal', money(input.subtotalCents));
  if (input.discountCents > 0) totalRow('Discount', `- ${money(input.discountCents)}`);

  // Show what tax was charged on, not just the figure. A customer — or an
  // auditor — has to be able to see which part of the document was taxed
  // without recomputing it, especially when some lines are relieved.
  const untaxed = input.untaxedBaseCents ?? 0;
  if (untaxed > 0 && typeof input.taxableBaseCents === 'number') {
    totalRow('Taxable amount', money(input.taxableBaseCents));
    totalRow('Non-taxable amount', money(untaxed));
  }
  if (input.taxCents > 0) {
    const where = input.taxJurisdiction ? ` (${input.taxJurisdiction})` : '';
    totalRow(`Sales tax${where}`, money(input.taxCents));
  } else if (input.subtotalCents > 0) {
    // Silence is not an answer: say that no tax was charged.
    totalRow('Sales tax', 'None');
  }

  doc.rect(left + pageWidth * 0.52, y - 4, pageWidth * 0.48, 30).fill(BRAND.panel);
  totalRow('TOTAL', money(input.totalCents), true, BRAND.terracotta);

  if (typeof input.amountPaidCents === 'number' && input.amountPaidCents > 0) {
    totalRow('Paid', money(input.amountPaidCents));
    totalRow('Balance due', money(Math.max(0, input.totalCents - input.amountPaidCents)), true);
  }

  /* -------------------------- notes and terms ---------------------------- */
  if (input.notes || input.terms) {
    y += 14;
    if (y > doc.page.height - 140) { doc.addPage(); y = 60; }
    if (input.notes) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND.muted).text('NOTES', left, y);
      y += 12;
      doc.fontSize(9).font('Helvetica').fillColor(BRAND.ink)
         .text(input.notes, left, y, { width: pageWidth * 0.7 });
      y = doc.y + 12;
    }
    if (input.terms) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND.muted).text('TERMS', left, y);
      y += 12;
      doc.fontSize(8.5).font('Helvetica').fillColor(BRAND.muted)
         .text(input.terms, left, y, { width: pageWidth * 0.7 });
    }
  }

  /* -------------------------------- footer -------------------------------- */
  // Footer is drawn on every page, including ones added mid-table.
  const range = doc.bufferedPageRange();
  const footerY = doc.page.height - 62;
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // The footer deliberately sits below the bottom margin. PDFKit would
    // otherwise treat it as overflow and push it onto a new page, so the
    // margin is lifted for the duration of the footer draw.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.moveTo(left, footerY).lineTo(right, footerY).strokeColor(BRAND.hairline).stroke();
    doc.fontSize(7.5).font('Helvetica').fillColor(BRAND.muted)
       .text(`Generated by Ruvik  |  ${input.from.name}  |  Page ${i - range.start + 1} of ${range.count}`,
             left, footerY + 8, { width: pageWidth * 0.6, lineBreak: false });
    if (input.verificationUrl) {
      doc.text(`Document digest verifiable at ${input.verificationUrl}`, left, footerY + 8, {
        width: pageWidth, align: 'right', lineBreak: false,
      });
    }

    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  const buffer = await done;
  return { buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
}
