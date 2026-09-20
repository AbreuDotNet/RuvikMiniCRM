import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { RequireRole } from '../src/components/Guard';
import {
  Badge, Banner, Button, Card, ErrorState, Input, ScreenScroll, SkeletonList,
  Stack, Switch, Text, useFeedback,
} from '../src/components/ui';
import { useBusinessProfile, useUpdateBusinessProfile } from '../src/features/provider/hooks';
import { errorMessage } from '../src/services/api';
import { spacing } from '../src/theme/tokens';
import { verificationStatus } from '../src/utils/status';
import type { BusinessProfile } from '../src/types/api';

export default function BusinessProfileRoute() {
  return (
    <RequireRole role="provider">
      <BusinessProfileScreen />
    </RequireRole>
  );
}

function BusinessProfileScreen() {
  const profile = useBusinessProfile();

  if (profile.isPending) {
    return <ScreenScroll><SkeletonList rows={4} /></ScreenScroll>;
  }
  if (profile.isError || !profile.data) {
    return (
      <ScreenScroll>
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </ScreenScroll>
    );
  }

  // The form only exists once there is something to fill it with, so its
  // fields initialise from props rather than being written into by an effect
  // after the fact. A refetch cannot then overwrite what is being typed.
  return <BusinessProfileForm initial={profile.data} />;
}

function BusinessProfileForm({ initial }: { initial: BusinessProfile }) {
  const { notify } = useFeedback();
  const update = useUpdateBusinessProfile();

  const [businessName, setBusinessName] = useState(initial.businessName);
  const [tagline, setTagline] = useState(initial.tagline ?? '');
  const [bio, setBio] = useState(initial.bio ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [whatsappPhone, setWhatsappPhone] = useState(initial.whatsappPhone ?? '');
  const [addressLine, setAddressLine] = useState(initial.addressLine ?? '');
  const [city, setCity] = useState(initial.city ?? '');
  const [region, setRegion] = useState(initial.region ?? '');
  const [postalCode, setPostalCode] = useState(initial.postalCode ?? '');
  const [isPublished, setIsPublished] = useState(initial.isPublished);

  const verification = verificationStatus(initial.verificationStatus);

  const save = async () => {
    try {
      await update.mutateAsync({
        businessName: businessName.trim(),
        tagline: tagline.trim() || null,
        bio: bio.trim() || null,
        phone: phone.trim() || null,
        whatsappPhone: whatsappPhone.trim() || null,
        addressLine: addressLine.trim() || null,
        city: city.trim() || null,
        region: region.trim() || null,
        postalCode: postalCode.trim() || null,
        isPublished,
      });
      notify('Profile saved.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            Business profile
          </Text>
          <Badge label={verification.label} tone={verification.tone} />
        </View>
        <Text variant="caption" tone="muted">
          This is what customers see when they find you.
        </Text>
      </Stack>

      {/* Verification status is read-only here and always will be: a business
          that could mark itself verified is a badge that means nothing. */}
      {initial.verificationStatus !== 'verified' ? (
        <Banner
          tone="info"
          title={verification.label}
          message="Verification is granted by Ruvik after a review. You cannot set it here."
          action={{ label: 'What is needed?', onPress: () => router.push('/verification') }}
        />
      ) : null}

      <Input label="Business name" value={businessName} onChangeText={setBusinessName} required />

      <Input
        label="Tagline"
        placeholder="Drywall and painting, done properly"
        hint="One line, shown under your name in search."
        value={tagline}
        onChangeText={setTagline}
      />

      <Input
        label="About"
        placeholder="Who you are, how long you have been doing this, what you are known for."
        multiline
        numberOfLines={5}
        value={bio}
        onChangeText={setBio}
      />

      <Input
        label="Phone"
        keyboardType="phone-pad"
        leftIcon="call-outline"
        value={phone}
        onChangeText={setPhone}
      />

      <Input
        label="WhatsApp number"
        keyboardType="phone-pad"
        leftIcon="logo-whatsapp"
        hint="Leave blank if it is the same as your phone."
        value={whatsappPhone}
        onChangeText={setWhatsappPhone}
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

      <Input
        label="ZIP code"
        keyboardType="number-pad"
        value={postalCode}
        onChangeText={setPostalCode}
      />

      <Card>
        <Switch
          label="Listed in search"
          description="Turn this off to take your listings out of search while staying signed up."
          value={isPublished}
          onChange={setIsPublished}
        />
        {/* Being published is necessary but not sufficient — a live
            subscription is the other half, and saying so here avoids the
            "I am published, so why is nobody calling" question. */}
        <Text variant="micro" tone="faint" style={{ marginTop: spacing.sm }}>
          Listings also need a live plan to appear. Both have to be true.
        </Text>
      </Card>

      <Button
        label="Save profile"
        disabled={businessName.trim().length < 2}
        loading={update.isPending}
        onPress={() => void save()}
      />
    </ScreenScroll>
  );
}
