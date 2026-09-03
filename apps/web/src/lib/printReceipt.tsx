import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Receipt, type ReceiptData } from '../components/Receipt';

/**
 * Sends a receipt to the local printer.
 *
 * ## Why this shape
 *
 * `window.print()` is synchronous and blocking: the dialog opens against
 * whatever is in the DOM *at that instant*. Rendering the receipt with normal
 * React state and calling print in the same tick prints the previous frame —
 * usually an empty page. So the receipt is mounted into a detached root and
 * committed with `flushSync` before the call.
 *
 * ## What "direct to the local printer" means here
 *
 * The OS print path: the browser rasterises the page and hands it to the
 * driver, which is how POS hardware is normally installed on Windows and
 * Android. The operator still sees the system dialog — browsers do not allow
 * silent printing, and a page that could print without consent would be a
 * hostile page. Picking the thermal printer as the default, and enabling
 * "kiosk printing" if the deployment runs a managed Chrome, removes the click
 * without removing the consent model.
 *
 * Byte-level ESC/POS over WebUSB or WebSerial is the other option: no dialog,
 * exact control of the cutter and the cash drawer. It needs a secure context,
 * a user gesture to grant device access, and the printer must not be claimed
 * by an OS driver — which is precisely what makes it fragile on a shared till.
 * The receipt payload from the server is transport-agnostic, so that path can
 * be added later without touching the data or this call site.
 */

export type PaperWidth = '80mm' | '58mm';

const ROOT_ID = 'receipt-print-root';
const PAPER_KEY = 'ruvik.receipt.paper';

/** Remembered per device: a till has one printer and it does not change. */
export function getPaperWidth(): PaperWidth {
  try {
    return localStorage.getItem(PAPER_KEY) === '58mm' ? '58mm' : '80mm';
  } catch {
    // Private mode or blocked storage: the common size is the safer guess.
    return '80mm';
  }
}

export function setPaperWidth(width: PaperWidth): void {
  try {
    localStorage.setItem(PAPER_KEY, width);
  } catch {
    // Not being able to remember the preference is not worth failing a sale.
  }
}

/**
 * Renders the receipt off-screen, prints it, then tears it down.
 *
 * Resolves once the print dialog has been dismissed — accepted or cancelled.
 * The browser does not tell us which, so the caller must not treat resolution
 * as proof that paper came out.
 */
export async function printReceipt(
  data: ReceiptData,
  paper: PaperWidth = getPaperWidth(),
): Promise<void> {
  // A stale root from an interrupted previous print would print twice.
  document.getElementById(ROOT_ID)?.remove();

  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.className = 'receipt-print-root';
  // Off-screen rather than `display: none`: a hidden subtree has no layout,
  // and the print stylesheet needs real boxes to measure.
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    // Commit synchronously: print() would otherwise open on the previous frame.
    flushSync(() => {
      root.render(<div className="receipt-preview"><Receipt data={data} paper={paper} /></div>);
    });

    // One more frame so fonts and layout settle before the snapshot.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await new Promise<void>((resolve) => {
      // afterprint fires on both accept and cancel; the timeout covers the
      // browsers that never fire it at all, so this can never hang the till.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.removeEventListener('afterprint', finish);
        resolve();
      };
      window.addEventListener('afterprint', finish);
      setTimeout(finish, 60_000);

      window.print();
    });
  } finally {
    // Unmount out of band: React refuses to unmount a root while it is
    // rendering, which is where we are inside a print handler.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }
}
