import { getDb, type Queryable } from '../../db/index.js';
import { enqueue } from '../../lib/queue.js';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Also attempt WhatsApp delivery (subject to the recipient's consent). */
  whatsapp?: {
    template: string;
    relatedType: 'quote' | 'invoice' | 'job' | 'subscription';
    relatedId: string;
    variables?: Record<string, string>;
  };
}

/**
 * Creates the in-app notification synchronously (so it is visible the moment
 * the API responds) and queues any external channel. The in-app record is
 * also the documented fallback when WhatsApp delivery fails.
 */
export async function notify(
  userId: string,
  input: NotificationInput,
  client?: Queryable,
): Promise<string> {
  const db = client ?? (await getDb());
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [userId, input.type, input.title, input.body, JSON.stringify(input.data ?? {})],
  );

  /*
   * Push, to whatever devices the recipient has registered.
   *
   * Queued unconditionally rather than gated on "does this user have a
   * device?": that question needs a query, the handler has to ask it anyway to
   * know where to send, and asking twice would mean a notification created
   * inside a transaction could miss a device registered moments earlier. A
   * recipient with no devices costs one cheap lookup and the job ends.
   *
   * Deduped on the notification id so a retry of the enclosing work cannot
   * ring the same handset twice for the same event.
   */
  await enqueue(
    'notification.push',
    {
      userId,
      notificationId: rows[0].id,
      title: input.title,
      body: input.body,
      data: { ...(input.data ?? {}), type: input.type, notificationId: rows[0].id },
    },
    { dedupeKey: `push:${rows[0].id}` },
    client,
  );

  if (input.whatsapp) {
    await enqueue(
      'whatsapp.send',
      {
        userId,
        template: input.whatsapp.template,
        relatedType: input.whatsapp.relatedType,
        relatedId: input.whatsapp.relatedId,
        variables: input.whatsapp.variables ?? {},
        notificationId: rows[0].id,
      },
      { dedupeKey: `wa:${input.whatsapp.relatedType}:${input.whatsapp.relatedId}:${input.whatsapp.template}` },
      client,
    );
  }

  return rows[0].id;
}
