import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { PageHeader } from '../../components/PageHeader';
import {
  Avatar, Badge, Button, Card, ConfirmSheet, Divider, ListRow, ScreenScroll,
  SectionHeader, Stack, Text, useFeedback,
} from '../../components/ui';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { initials } from '../../utils/format';
import { subscriptionStatus, verificationStatus } from '../../utils/status';

interface AccountLink {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  href: string;
  badge?: { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'primary' | 'info' };
}

/**
 * The account tab, shared by all three roles.
 *
 * The role-specific entries are passed in rather than branched on here, so a
 * new section is a list entry in one file instead of another condition in
 * this one.
 */
export function AccountScreen({ extraSections }: { extraSections?: { title: string; links: AccountLink[] }[] }) {
  const theme = useTheme();
  const { user, logout } = useAuth();
  const { notify } = useFeedback();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!user) return null;

  const accountLinks: AccountLink[] = [
    {
      icon: 'person-outline',
      title: 'Your details',
      subtitle: 'Name, phone and where you are',
      href: '/settings/profile',
    },
    {
      icon: 'lock-closed-outline',
      title: 'Security',
      subtitle: user.mfaEnabled ? 'Two-factor is on' : 'Password and two-factor',
      href: '/settings/security',
      badge: user.mfaEnabled
        ? { label: '2FA on', tone: 'success' }
        : undefined,
    },
    {
      icon: 'logo-whatsapp',
      title: 'WhatsApp updates',
      subtitle: user.whatsappOptIn ? 'Turned on' : 'Turned off',
      href: '/settings/messaging',
    },
    {
      icon: 'contrast-outline',
      title: 'Appearance',
      subtitle: 'Light, dark or follow the system',
      href: '/settings/appearance',
    },
  ];

  const sections = [
    ...(extraSections ?? []),
    { title: 'Account', links: accountLinks },
  ];

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      // The root layout takes it from here.
    } catch {
      notify('We could not sign you out cleanly, but this device is signed out.', 'info');
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
    }
  };

  return (
    <ScreenScroll>
      <PageHeader title="Account" />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar initials={initials(user.fullName)} size={52} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" numberOfLines={1}>{user.fullName}</Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>{user.email}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
              <Badge label={user.role} tone="primary" />
              {user.role === 'provider' && user.providerStatus ? (
                <Badge
                  label={verificationStatus(user.providerStatus).label}
                  tone={verificationStatus(user.providerStatus).tone}
                />
              ) : null}
              {user.role === 'provider' && user.subscriptionStatus ? (
                <Badge
                  label={subscriptionStatus(user.subscriptionStatus).label}
                  tone={subscriptionStatus(user.subscriptionStatus).tone}
                />
              ) : null}
            </View>
          </View>
        </View>
      </Card>

      {sections.map((section) => (
        <Stack key={section.title} gap={spacing.sm}>
          <SectionHeader title={section.title} />
          <Card padded={false}>
            {section.links.map((link, index) => (
              <View key={link.href}>
                {index > 0 ? <Divider inset={spacing.lg + 36} /> : null}
                <ListRow
                  leading={
                    <View
                      style={{
                        width: 32, height: 32, borderRadius: 10,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: theme.colors.surfaceMuted,
                      }}
                    >
                      <Ionicons name={link.icon} size={17} color={theme.colors.textMuted} />
                    </View>
                  }
                  title={link.title}
                  subtitle={link.subtitle}
                  trailing={link.badge ? <Badge label={link.badge.label} tone={link.badge.tone} /> : undefined}
                  onPress={() => router.push(link.href as never)}
                />
              </View>
            ))}
          </Card>
        </Stack>
      ))}

      <Button
        label="Sign out"
        variant="secondary"
        icon="log-out-outline"
        onPress={() => setConfirmOpen(true)}
      />

      <Text variant="micro" tone="faint" align="center">
        Ruvik · signed in as {user.email}
      </Text>

      <ConfirmSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Sign out?"
        message="This device will be signed out. Any other devices stay signed in."
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={() => void signOut()}
      />
    </ScreenScroll>
  );
}

export type { AccountLink };
