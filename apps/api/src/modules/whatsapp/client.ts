import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { serviceUnavailable } from '../../lib/errors.js';

/**
 * Thin client for the official WhatsApp Business Platform (Cloud API).
 * No unofficial gateway, no web automation.
 *
 * When WHATSAPP_ENABLED is false the client runs in simulation mode so the
 * whole flow (consent, queue, status log, fallback) is exercisable in dev
 * and tests without contacting Meta.
 */

export interface TemplateMessage {
  toPhoneE164: string;
  templateName: string;
  languageCode: string;
  /** Body variables, in template order. */
  variables: string[];
  /** Optional document header, e.g. a signed link to a quote PDF. */
  document?: { link: string; filename: string };
}

export interface SendResult {
  messageId: string;
  simulated: boolean;
}

/* ------------------------------ circuit breaker --------------------------- */

const BREAKER = {
  failures: 0,
  openedAt: 0,
  threshold: 5,
  cooldownMs: 60_000,
};

function breakerOpen(): boolean {
  if (BREAKER.failures < BREAKER.threshold) return false;
  if (Date.now() - BREAKER.openedAt > BREAKER.cooldownMs) {
    BREAKER.failures = 0; // half-open: let the next call probe the API
    return false;
  }
  return true;
}

function recordFailure() {
  BREAKER.failures += 1;
  if (BREAKER.failures === BREAKER.threshold) {
    BREAKER.openedAt = Date.now();
    logger.error('whatsapp circuit breaker opened');
  }
}

export function resetBreaker() {
  BREAKER.failures = 0;
  BREAKER.openedAt = 0;
}

export async function sendTemplate(msg: TemplateMessage): Promise<SendResult> {
  if (!env.WHATSAPP_ENABLED || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info(
      { template: msg.templateName, to: maskPhone(msg.toPhoneE164) },
      'whatsapp simulated (integration disabled)',
    );
    return { messageId: `sim_${crypto.randomBytes(10).toString('hex')}`, simulated: true };
  }

  if (breakerOpen()) throw serviceUnavailable('WhatsApp is temporarily unavailable.');

  const components: unknown[] = [];
  if (msg.document) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { link: msg.document.link, filename: msg.document.filename } }],
    });
  }
  if (msg.variables.length) {
    components.push({
      type: 'body',
      parameters: msg.variables.map((text) => ({ type: 'text', text })),
    });
  }

  const url = `${env.WHATSAPP_API_BASE}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msg.toPhoneE164,
        type: 'template',
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode },
          ...(components.length ? { components } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      recordFailure();
      // 4xx is a template/permission problem and will not fix itself on retry.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      const err = new Error(`WhatsApp API ${res.status}: ${detail.slice(0, 300)}`);
      (err as Error & { permanent?: boolean }).permanent = permanent;
      throw err;
    }

    const body = (await res.json()) as { messages?: Array<{ id: string }> };
    BREAKER.failures = 0;
    return { messageId: body.messages?.[0]?.id ?? 'unknown', simulated: false };
  } catch (err) {
    if ((err as Error).name === 'AbortError') recordFailure();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** +18095551234 -> +1809*****34 — enough to support a user, not enough to leak. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***';
  return `${phone.slice(0, 5)}${'*'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-2)}`;
}

/** Meta signs webhooks with HMAC-SHA256 over the raw body. */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET || !signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
