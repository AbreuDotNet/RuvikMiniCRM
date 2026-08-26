import type { Queryable } from '../db/index.js';

const PREFIX: Record<string, string> = { quote: 'Q', invoice: 'INV', job: 'JOB' };

/**
 * Per-provider, per-year document numbers (Q-2026-0001).
 *
 * The counter row is locked with UPDATE ... RETURNING inside the caller's
 * transaction, so two concurrent quote creations cannot claim the same
 * number — duplicate invoice numbers are an accounting problem, not a
 * cosmetic one.
 */
export async function nextNumber(
  client: Queryable,
  providerId: string,
  kind: 'quote' | 'invoice' | 'job',
  now = new Date(),
): Promise<string> {
  const period = String(now.getUTCFullYear());

  const { rows } = await client.query<{ last_value: number }>(
    `INSERT INTO number_sequences (provider_id, kind, period, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (provider_id, kind, period)
     DO UPDATE SET last_value = number_sequences.last_value + 1
     RETURNING last_value`,
    [providerId, kind, period],
  );

  const seq = String(rows[0].last_value).padStart(4, '0');
  return `${PREFIX[kind]}-${period}-${seq}`;
}
