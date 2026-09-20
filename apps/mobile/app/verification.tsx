import { useState } from 'react';
import { View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { RequireRole } from '../src/components/Guard';
import {
  Badge, Banner, Button, Card, ErrorState, ScreenScroll, SkeletonList,
  Stack, Text, useFeedback,
} from '../src/components/ui';
import { useBusinessProfile } from '../src/features/provider/hooks';
import { uploadFile } from '../src/services/files';
import { errorMessage } from '../src/services/api';
import { spacing } from '../src/theme/tokens';
import { verificationStatus } from '../src/utils/status';

export default function VerificationRoute() {
  return (
    <RequireRole role="provider">
      <VerificationScreen />
    </RequireRole>
  );
}

/**
 * Verification, and the honest limit of it.
 *
 * A provider can upload documents — `/files/uploads` takes them and the
 * scanner quarantines them until checked. What the API has no endpoint for is
 * *asking to be reviewed*: only an administrator can move a provider into
 * `pending`. Rather than pretend, this screen uploads the document and says
 * plainly that a person has to pick it up from there.
 */
function VerificationScreen() {
  const { notify } = useFeedback();
  const profile = useBusinessProfile();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);

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

  const status = verificationStatus(profile.data.verificationStatus);

  const pickAndUpload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.length) return;

    const asset = picked.assets[0];
    if (!asset) return;

    setUploading(true);
    try {
      const result = await uploadFile({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'application/pdf',
        filename: asset.name,
        kind: 'document',
      });
      setUploaded((current) => [...current, asset.name]);
      notify(result.message, 'success');
    } catch (err) {
      notify(errorMessage(err, 'That file could not be uploaded.'), 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <ScreenScroll>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>Verification</Text>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <Text variant="caption" tone="muted">
          Verified businesses carry a badge in search results and win more work.
        </Text>
      </Stack>

      {profile.data.verificationStatus === 'verified' ? (
        <Banner
          tone="success"
          title="You are verified"
          message="Your badge shows on your profile and in every search result you appear in."
        />
      ) : profile.data.verificationStatus === 'rejected' ? (
        <Banner
          tone="danger"
          title="Not approved"
          message="Ruvik reviewed your documents and did not approve them. Support can tell you what was missing."
        />
      ) : profile.data.verificationStatus === 'pending'
        || profile.data.verificationStatus === 'info_requested' ? (
        <Banner
          tone="warning"
          title={status.label}
          message="Your documents are with the Ruvik team. You will be notified when the review finishes."
        />
      ) : null}

      <Card>
        <Stack gap={spacing.sm}>
          <Text variant="heading">What to send</Text>
          <Text variant="caption" tone="muted">
            A trade licence or registration, proof of insurance, and anything a customer would
            reasonably want to see. PDF, JPEG or PNG, up to 8MB each.
          </Text>
        </Stack>
      </Card>

      <Button
        label="Upload a document"
        icon="cloud-upload-outline"
        loading={uploading}
        onPress={() => void pickAndUpload()}
      />

      {uploaded.length ? (
        <Card>
          <Stack gap={spacing.xs}>
            <Text variant="micro" tone="muted" uppercase>Uploaded this session</Text>
            {uploaded.map((name) => (
              <Text key={name} variant="caption" tone="muted">• {name}</Text>
            ))}
            <Text variant="micro" tone="faint">
              Each file is scanned before anyone can open it.
            </Text>
          </Stack>
        </Card>
      ) : null}

      {/* Stated rather than hidden: the app cannot start the review, and a
          provider who uploads a file and hears nothing deserves to know why
          instead of assuming it was lost. */}
      <Banner
        tone="info"
        title="Asking for a review is not automatic yet"
        message={
          'Uploading stores your documents, but Ruvik has no way for you to submit yourself for '
          + 'review from here — an administrator starts it. Contact support once your documents are up.'
        }
      />
    </ScreenScroll>
  );
}
