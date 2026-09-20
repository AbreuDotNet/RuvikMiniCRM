import { AccountScreen } from '../../src/features/account/AccountScreen';

/**
 * Admins get profile, security and preferences on mobile, and nothing else.
 *
 * Moderation, audit and the provider lifecycle stay on the web panel: they
 * need a wide table, a reason field and a two-factor session, and a reduced
 * version of that on a phone is how a destructive action gets taken by
 * accident on a bus.
 */
export default function AdminAccount() {
  return <AccountScreen />;
}
