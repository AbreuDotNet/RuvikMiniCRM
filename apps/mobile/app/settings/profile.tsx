import { useState } from 'react';
import { View } from 'react-native';

import { RequireSession } from '../../src/components/Guard';
import {
  Button, ErrorState, Input, ScreenScroll, Segmented, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useAccountProfile, useUpdateAccountProfile } from '../../src/features/account/hooks';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import type { AccountProfile } from '../../src/types/api';

export default function ProfileSettingsRoute() {
  return (
    <RequireSession>
      <ProfileSettings />
    </RequireSession>
  );
}

function ProfileSettings() {
  const profile = useAccountProfile();

  if (profile.isPending) {
    return <ScreenScroll><SkeletonList rows={3} /></ScreenScroll>;
  }
  if (profile.isError || !profile.data) {
    return (
      <ScreenScroll>
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </ScreenScroll>
    );
  }

  // Initialised from props on mount rather than written in by an effect, so a
  // background refetch cannot overwrite a half-typed field.
  return <ProfileForm initial={profile.data} />;
}

function ProfileForm({ initial }: { initial: AccountProfile }) {
  const { notify } = useFeedback();
  const { refreshUser } = useAuth();
  const update = useUpdateAccountProfile();

  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [city, setCity] = useState(initial.city ?? '');
  const [region, setRegion] = useState(initial.region ?? '');
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? '');
  const [locale, setLocale] = useState<'en' | 'es'>(initial.locale === 'es' ? 'es' : 'en');

  const save = async () => {
    try {
      await update.mutateAsync({
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        addressLine: addressLine.trim() || null,
        locale,
      });
      await refreshUser();
      notify('Saved.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Your details</Text>
        <Text variant="caption" tone="muted">{initial.email}</Text>
      </Stack>

      <Input label="Name" value={fullName} onChangeText={setFullName} required />

      <Input
        label="Phone"
        keyboardType="phone-pad"
        leftIcon="call-outline"
        value={phone}
        onChangeText={setPhone}
      />

      <Input label="Address" value={addressLine} onChangeText={setAddressLine} />

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Input containerStyle={{ flex: 2 }} label="City" value={city} onChangeText={setCity} />
        <Input
          containerStyle={{ flex: 1 }}
          label="State"
          autoCapitalize="characters"
          value={region}
          onChangeText={setRegion}
        />
      </View>

      <Segmented
        label="Language"
        options={[
          { value: 'en' as const, label: 'English' },
          { value: 'es' as const, label: 'Español' },
        ]}
        value={locale}
        onChange={setLocale}
      />
      {/* Honest about scope: the preference is stored on the account and used
          by the server for email and WhatsApp. The app itself is English for
          now, and claiming otherwise would be a lie the next screen exposes. */}
      <Text variant="micro" tone="faint">
        Used for the messages Ruvik sends you. The app itself is in English for now.
      </Text>

      <Button
        label="Save"
        disabled={fullName.trim().length < 2}
        loading={update.isPending}
        onPress={() => void save()}
      />

      <Text variant="micro" tone="faint" align="center">
        Your email address cannot be changed here. Contact support if you need it moved.
      </Text>
    </ScreenScroll>
  );
}
