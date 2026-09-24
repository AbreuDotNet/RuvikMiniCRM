-- ===========================================================================
-- Push device tokens
-- ===========================================================================
--
-- The device half of push has worked since the mobile app shipped: the
-- permission prompt, the Android channel, the Expo token and the tap handler
-- that routes a notification to the thing it is about. What was missing was
-- anywhere to put the token. `services/push.ts` said so in its own header —
-- every launch obtained a token and threw it away, and the `notification.push`
-- queue handler was registered as `async () => undefined`.
--
-- The effect was commercial rather than cosmetic. A provider learned about a
-- new lead the next time they happened to open the app, in a market where the
-- first tradesperson to call back wins the job.
--
-- One row per device, not per person. A token identifies an installation, so
-- the unique index is on the token alone: signing out of one account and into
-- another on the same handset must *move* the token, not leave the previous
-- user's leads ringing on it. `ON CONFLICT (token) DO UPDATE SET user_id` is
-- what makes that reassignment the default rather than something the app has
-- to remember to do.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ios','android','web')),
  /*
   * Which service minted the token.
   *
   * Expo today, because the app is an Expo build and its tokens are Expo
   * tokens. Recording it means a later move to APNs and FCM directly is a
   * migration with both kinds coexisting, rather than a flag day where every
   * installed handset has to re-register before it can be reached.
   */
  push_service  text NOT NULL DEFAULT 'expo' CHECK (push_service IN ('expo')),
  /*
   * Consecutive delivery failures that were not fatal.
   *
   * A fatal one — Expo's DeviceNotRegistered — deletes the row outright, since
   * the app is gone and the token will never work again. This counts the other
   * kind, so a token failing steadily for a softer reason can be pruned before
   * it costs a request on every notification for ever.
   */
  failure_count integer NOT NULL DEFAULT 0,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One handset, one token. Re-registering it under another account moves it.
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_uniq ON device_tokens (token);

-- The only read on the hot path: "where do I send this user's notification?"
CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens (user_id);
