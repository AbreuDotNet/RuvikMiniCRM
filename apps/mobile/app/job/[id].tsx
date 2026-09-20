import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Banner, Button, Card, DetailRow, Divider, ErrorState, Input, ListRow,
  ScreenScroll, SectionHeader, Segmented, Sheet, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useAddJobNote, useAdvanceJob, useJob } from '../../src/features/crm/hooks';
import { errorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme/ThemeProvider';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatDateTime, formatMoney, formatRelative } from '../../src/utils/format';
import { invoiceStatus, jobStatus, quoteStatus } from '../../src/utils/status';

export default function JobRoute() {
  return (
    <RequireRole role="provider">
      <JobDetailScreen />
    </RequireRole>
  );
}

function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = id ?? '';
  const job = useJob(jobId);
  const [statusSheet, setStatusSheet] = useState(false);
  const [noteSheet, setNoteSheet] = useState(false);

  if (job.isPending) {
    return <ScreenScroll><SkeletonList rows={4} /></ScreenScroll>;
  }
  if (job.isError || !job.data) {
    return (
      <ScreenScroll>
        <ErrorState error={job.error} onRetry={() => void job.refetch()} />
      </ScreenScroll>
    );
  }

  const j = job.data;
  const look = jobStatus(j.status);
  const address = [j.addressLine, j.city, j.region, j.postalCode].filter(Boolean).join(', ');

  return (
    <ScreenScroll refreshing={job.isRefetching} onRefresh={() => void job.refetch()}>
      <Stack gap={spacing.sm}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" accessibilityRole="header">{j.title}</Text>
            <Text variant="caption" tone="muted">{j.reference}</Text>
          </View>
          <Badge label={look.label} tone={look.tone} />
        </View>
        {look.hint ? <Text variant="caption" tone="muted">{look.hint}</Text> : null}
      </Stack>

      {/* `allowedNextStatuses` is the server's list, not a guess. When it is
          empty the job is finished or cancelled, and no button is offered —
          rather than one that would come back with a 409. */}
      {j.allowedNextStatuses.length ? (
        <Button
          label="Move this job on"
          icon="arrow-forward-circle-outline"
          onPress={() => setStatusSheet(true)}
        />
      ) : (
        <Banner
          tone="neutral"
          message={
            j.status === 'completed'
              ? 'This job is complete. The client can now leave a review.'
              : 'This job is closed. Its history stays on the record.'
          }
        />
      )}

      <Card>
        <Stack gap={spacing.sm}>
          <Text variant="heading">{j.client.fullName}</Text>
          <Stack gap={2}>
            {j.client.phone ? <DetailRow label="Phone" value={j.client.phone} /> : null}
            {j.client.email ? <DetailRow label="Email" value={j.client.email} /> : null}
            {address ? <DetailRow label="Where" value={address} /> : null}
          </Stack>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {j.client.phone ? (
              <Button
                label="Call"
                variant="secondary"
                size="sm"
                icon="call-outline"
                style={{ flex: 1 }}
                onPress={() => void Linking.openURL(`tel:${j.client.phone}`)}
              />
            ) : null}
            {j.client.whatsappPhone ? (
              <Button
                label="WhatsApp"
                variant="secondary"
                size="sm"
                icon="logo-whatsapp"
                style={{ flex: 1 }}
                onPress={() => void Linking.openURL(
                  `https://wa.me/${j.client.whatsappPhone!.replace(/[^\d]/g, '')}`,
                )}
              />
            ) : null}
            <Button
              label="Client"
              variant="secondary"
              size="sm"
              icon="person-outline"
              style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/client/[id]', params: { id: j.client.id } })}
            />
          </View>
        </Stack>
      </Card>

      {j.description ? (
        <Card>
          <Stack gap={spacing.xs}>
            <Text variant="micro" tone="muted" uppercase>Brief</Text>
            <Text variant="body" tone="muted">{j.description}</Text>
          </Stack>
        </Card>
      ) : null}

      <Card>
        <Stack gap={2}>
          <Text variant="heading" style={{ marginBottom: spacing.xs }}>Schedule</Text>
          <DetailRow
            label="Starts"
            value={j.scheduledStart ? formatDateTime(j.scheduledStart) : 'Not scheduled'}
            strong={Boolean(j.scheduledStart)}
          />
          {j.completedAt ? <DetailRow label="Completed" value={formatDate(j.completedAt)} /> : null}
          <DetailRow label="Created" value={formatDate(j.createdAt)} />
          {j.serviceTitle ? <DetailRow label="From listing" value={j.serviceTitle} /> : null}
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title={`Quotes (${j.quotes.length})`}
          action={{
            label: 'New quote',
            onPress: () => router.push({ pathname: '/quote/new', params: { jobId: j.id } }),
          }}
        />
        {!j.quotes.length ? (
          <Card>
            <Text variant="caption" tone="muted">No quotes on this job yet.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {j.quotes.map((quote, index) => {
              const status = quoteStatus(quote.status);
              return (
                <View key={quote.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={formatMoney(quote.totalCents, quote.currency)}
                    subtitle={quote.number}
                    meta={quote.validUntil ? `Valid until ${formatDate(quote.validUntil)}` : undefined}
                    trailing={<Badge label={status.label} tone={status.tone} />}
                    onPress={() => router.push({ pathname: '/quote/[id]', params: { id: quote.id } })}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title={`Invoices (${j.invoices.length})`}
          action={{
            label: 'New invoice',
            onPress: () => router.push({ pathname: '/invoice/new', params: { jobId: j.id } }),
          }}
        />
        {!j.invoices.length ? (
          <Card>
            <Text variant="caption" tone="muted">Nothing invoiced yet.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {j.invoices.map((invoice, index) => {
              const status = invoiceStatus(invoice.status);
              const outstanding = invoice.totalCents - invoice.amountPaidCents;
              return (
                <View key={invoice.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={formatMoney(invoice.totalCents, invoice.currency)}
                    subtitle={invoice.number}
                    meta={outstanding > 0
                      ? `${formatMoney(outstanding, invoice.currency)} outstanding`
                      : 'Settled'}
                    trailing={<Badge label={status.label} tone={status.tone} />}
                    onPress={() => router.push({
                      pathname: '/invoice/[id]', params: { id: invoice.id },
                    })}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title={`Notes (${j.notes.length})`}
          action={{ label: 'Add note', onPress: () => setNoteSheet(true) }}
        />
        {!j.notes.length ? (
          <Card>
            <Text variant="caption" tone="muted">No notes yet.</Text>
          </Card>
        ) : (
          <Card padded={false}>
            {j.notes.map((note, index) => (
              <View key={note.id}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <View style={{ padding: spacing.lg, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Badge
                      label={note.visibility === 'internal' ? 'Private' : 'Client sees this'}
                      tone={note.visibility === 'internal' ? 'neutral' : 'primary'}
                    />
                  </View>
                  <Text variant="body">{note.body}</Text>
                  <Text variant="micro" tone="faint">
                    {note.authorName} · {formatRelative(note.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}
      </Stack>

      {j.timeline.length ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="History" />
          <Card>
            <Stack gap={spacing.md}>
              {j.timeline.map((entry, index) => (
                <TimelineEntry
                  key={`${entry.createdAt}-${index}`}
                  from={entry.fromStatus}
                  to={entry.toStatus}
                  note={entry.note}
                  at={entry.createdAt}
                />
              ))}
            </Stack>
          </Card>
        </Stack>
      ) : null}

      <StatusSheet
        visible={statusSheet}
        onClose={() => setStatusSheet(false)}
        jobId={j.id}
        current={j.status}
        allowed={j.allowedNextStatuses}
      />

      <NoteSheet visible={noteSheet} onClose={() => setNoteSheet(false)} jobId={j.id} />
    </ScreenScroll>
  );
}

function TimelineEntry({
  from, to, note, at,
}: {
  from: string | null;
  to: string;
  note: string | null;
  at: string;
}) {
  const theme = useTheme();
  const look = jobStatus(to);

  return (
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <View
        accessibilityElementsHidden
        style={{
          width: 8, height: 8, borderRadius: 4, marginTop: 6,
          backgroundColor: theme.colors.primary,
        }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption">
          {from ? `${jobStatus(from).label} → ${look.label}` : look.label}
        </Text>
        {note ? <Text variant="micro" tone="muted">{note}</Text> : null}
        <Text variant="micro" tone="faint">{formatDateTime(at)}</Text>
      </View>
    </View>
  );
}

function StatusSheet({
  visible, onClose, jobId, current, allowed,
}: {
  visible: boolean;
  onClose: () => void;
  jobId: string;
  current: string;
  allowed: string[];
}) {
  const { notify } = useFeedback();
  const advance = useAdvanceJob(jobId);
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const apply = async () => {
    if (!target) return;
    try {
      await advance.mutateAsync({ status: target, note: note.trim() || undefined });
      notify(`Moved to ${jobStatus(target).label.toLowerCase()}.`, 'success');
      setTarget(null);
      setNote('');
      onClose();
    } catch (err) {
      // A 409 here means the job moved underneath us — someone else, or
      // another device. The server's message says so; showing it is more
      // useful than a generic failure.
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Move this job on"
      subtitle={`Currently ${jobStatus(current).label.toLowerCase()}. Only the steps the pipeline allows are shown.`}
    >
      <Stack gap={spacing.sm}>
        {allowed.map((status) => {
          const look = jobStatus(status);
          const selected = target === status;
          return (
            <ListRow
              key={status}
              title={look.label}
              subtitle={look.hint}
              trailing={selected ? <Badge label="Selected" tone="primary" /> : undefined}
              onPress={() => setTarget(status)}
            />
          );
        })}
      </Stack>

      <Input
        label="Note (optional)"
        placeholder="Client confirmed the date by phone."
        multiline
        numberOfLines={3}
        value={note}
        onChangeText={setNote}
      />

      <Button
        label={target ? `Move to ${jobStatus(target).label.toLowerCase()}` : 'Choose a step'}
        disabled={!target}
        loading={advance.isPending}
        haptic
        onPress={() => void apply()}
      />
    </Sheet>
  );
}

function NoteSheet({
  visible, onClose, jobId,
}: {
  visible: boolean;
  onClose: () => void;
  jobId: string;
}) {
  const { notify } = useFeedback();
  const addNote = useAddJobNote(jobId);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'customer'>('internal');

  const save = async () => {
    try {
      await addNote.mutateAsync({ body: body.trim(), visibility });
      notify('Note saved.', 'success');
      setBody('');
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add a note">
      <Segmented
        label="Who can see this?"
        options={[
          { value: 'internal' as const, label: 'Only me' },
          { value: 'customer' as const, label: 'The client too' },
        ]}
        value={visibility}
        onChange={setVisibility}
      />
      {/* Said plainly because the choice is irreversible in practice: a note
          the client can see has been seen by the time you regret it. */}
      <Text variant="micro" tone="muted">
        {visibility === 'internal'
          ? 'Private notes never leave your account.'
          : 'The client sees this on their request in their app.'}
      </Text>

      <Input
        label="Note"
        placeholder="Needs a second coat once the filler is dry."
        multiline
        numberOfLines={4}
        value={body}
        onChangeText={setBody}
      />

      <Button
        label="Save note"
        disabled={body.trim().length < 1}
        loading={addNote.isPending}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
