import { PageHeader } from '../../src/components/PageHeader';
import {
  Banner, Card, ScreenScroll, Stack, Text,
} from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { spacing } from '../../src/theme/tokens';

/**
 * What an admin can do here, and what they cannot.
 *
 * Stating the boundary is the screen's job. An admin who opens the app
 * expecting the panel and finds three tabs should learn why in the first
 * sentence, not by hunting for a menu that is not there.
 */
export default function AdminOverview() {
  const { user, sessionAal, adminMfaRequired } = useAuth();

  const needsSecondFactor = adminMfaRequired !== false && sessionAal !== 'mfa';

  return (
    <ScreenScroll>
      <PageHeader title="Ruvik admin" subtitle={user?.email} />

      <Banner
        tone="info"
        title="Moderation lives on the web panel"
        message={
          'Provider verification, user status, reviews and audit logs need a reason, a full '
          + 'history in view and a two-factor session. Those stay on the desktop panel on purpose.'
        }
      />

      {needsSecondFactor ? (
        <Banner
          tone="warning"
          title="Two-factor required for changes"
          message={
            'This session signed in with a password only. Administrative changes need a '
            + 'two-factor session — set one up under Security, then sign in again.'
          }
        />
      ) : null}

      <Card>
        <Stack gap={spacing.sm}>
          <Text variant="heading">What you can do here</Text>
          <Text variant="caption" tone="muted">
            Read your notifications, keep your own details current, and manage the security of
            your account — including enrolling the second factor the panel asks for.
          </Text>
        </Stack>
      </Card>
    </ScreenScroll>
  );
}
