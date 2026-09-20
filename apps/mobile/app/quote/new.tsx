import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Banner, Button, Card, Divider, EmptyState, Input, ListRow, ScreenScroll,
  SectionHeader, Sheet, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { LineEditor } from '../../src/features/quotes/LineEditor';
import { useCreateQuote } from '../../src/features/quotes/hooks';
import { useJobs } from '../../src/features/crm/hooks';
import { useTaxSettings } from '../../src/features/provider/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { formatMoney } from '../../src/utils/format';
import { computeTotals } from '../../src/utils/money';
import { parseAmountToCents } from '../../src/utils/moneyInput';
import { LINE_KIND_LABELS } from '../../src/utils/status';
import type { LineInput } from '../../src/types/api';

export default function NewQuoteRoute() {
  return (
    <RequireRole role="provider">
      <QuoteBuilder />
    </RequireRole>
  );
}

function QuoteBuilder() {
  const params = useLocalSearchParams<{ jobId?: string }>();
  const { notify } = useFeedback();

  const jobs = useJobs({});
  const taxSettings = useTaxSettings();
  const createQuote = useCreateQuote();

  const [jobId, setJobId] = useState<string | undefined>(params.jobId);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [lines, setLines] = useState<LineInput[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedJob = jobs.items.find((job) => job.id === jobId);
  const discountParsed = parseAmountToCents(discount || '0');
  const discountCents = discountParsed.cents ?? 0;

  /**
   * A preview, not a calculation.
   *
   * This runs the same algorithm the API runs — the file is a mirror kept in
   * step by a parity test — so the provider is not shown one total and then
   * sent another. What gets stored is whatever the server computes from the
   * lines below.
   */
  const totals = useMemo(
    () => computeTotals(
      lines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        taxRateBp: line.taxRateBp,
        taxTreatment: line.taxTreatment,
      })),
      discountCents,
    ),
    [lines, discountCents],
  );

  const canSave = Boolean(jobId) && lines.length > 0 && !discountParsed.error;

  /**
   * Saves a draft and hands off to the quote screen, where it is sent.
   *
   * Deliberately not one button that creates and sends: sending freezes the
   * document the customer will see, and that deserves a look at the finished
   * figures rather than being a side effect of saving.
   */
  const save = async () => {
    if (!jobId) return;
    setSaving(true);
    try {
      const created = await createQuote.mutateAsync({
        jobId,
        lines,
        discountCents,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
      });
      notify(`Draft ${created.number} saved.`, 'success');
      router.replace({ pathname: '/quote/[id]', params: { id: created.id } });
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">New quote</Text>
        <Text variant="caption" tone="muted">
          Build the lines, check the total, then send it. It stays a draft until you do.
        </Text>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Job" />
        <Card padded={false}>
          <ListRow
            title={selectedJob ? selectedJob.title : 'Choose a job'}
            subtitle={selectedJob ? selectedJob.client.fullName : 'Every quote belongs to one job'}
            meta={selectedJob?.reference}
            onPress={() => setJobPickerOpen(true)}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title={`Lines (${lines.length})`}
          action={{ label: 'Add line', onPress: () => setAdding(true) }}
        />
        {!lines.length ? (
          <Card>
            <EmptyState
              icon="list-outline"
              title="No lines yet"
              message="Add labour, materials and anything else you are charging for."
              action={{ label: 'Add the first line', onPress: () => setAdding(true) }}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {lines.map((line, index) => (
              <View key={`${line.description}-${index}`}>
                {index > 0 ? <Divider inset={spacing.lg} /> : null}
                <ListRow
                  title={line.description}
                  subtitle={`${line.quantity} × ${formatMoney(line.unitPriceCents)}`}
                  meta={LINE_KIND_LABELS[line.lineKind] ?? line.lineKind}
                  trailing={
                    line.taxTreatment !== 'taxable'
                      ? <Badge label="No tax" tone="info" />
                      : undefined
                  }
                  onPress={() => setEditingIndex(index)}
                />
              </View>
            ))}
          </Card>
        )}
      </Stack>

      {lines.length ? (
        <>
          <Input
            label="Discount"
            placeholder="0.00"
            keyboardType="decimal-pad"
            leftIcon="pricetag-outline"
            hint="Spread across the lines in proportion, exactly as the server does it."
            value={discount}
            onChangeText={setDiscount}
            error={discount ? discountParsed.error : undefined}
          />

          <Card>
            <Stack gap={spacing.xs}>
              <Row label="Subtotal" value={formatMoney(totals.subtotalCents)} />
              {totals.discountCents > 0 ? (
                <Row label="Discount" value={`-${formatMoney(totals.discountCents)}`} />
              ) : null}
              {totals.untaxedBaseCents > 0 ? (
                <Row label="Untaxed base" value={formatMoney(totals.untaxedBaseCents)} muted />
              ) : null}
              <Row label="Sales tax" value={formatMoney(totals.taxCents)} />
              <Divider />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
                <Text variant="heading">Total</Text>
                <Text variant="title">{formatMoney(totals.totalCents)}</Text>
              </View>
              <Text variant="micro" tone="faint">
                A preview. The server recalculates these figures when the quote is saved.
              </Text>
            </Stack>
          </Card>
        </>
      ) : null}

      {taxSettings.data && !taxSettings.data.taxState ? (
        <Banner
          tone="warning"
          title="No tax state set"
          message="Set the state you work in so new lines start with the right rate instead of zero."
          action={{ label: 'Open tax settings', onPress: () => router.push('/settings/tax') }}
        />
      ) : null}

      <Input
        label="Notes for the customer"
        placeholder="Includes clean-up and disposal."
        multiline
        numberOfLines={3}
        value={notes}
        onChangeText={setNotes}
      />

      <Input
        label="Terms"
        placeholder="50% on acceptance, balance on completion."
        multiline
        numberOfLines={3}
        value={terms}
        onChangeText={setTerms}
      />

      <Stack gap={spacing.sm}>
        <Button
          label="Save as draft"
          disabled={!canSave}
          loading={saving}
          onPress={() => void save()}
        />
        <Text variant="micro" tone="faint" align="center">
          You can review the draft and send it from the quote screen.
        </Text>
      </Stack>

      <Sheet
        visible={jobPickerOpen}
        onClose={() => setJobPickerOpen(false)}
        title="Which job?"
        subtitle="Quotes hang off a job, which is what carries the address and the client."
      >
        {jobs.isPending ? (
          <Text variant="caption" tone="muted">Loading jobs…</Text>
        ) : !jobs.items.length ? (
          <EmptyState
            icon="briefcase-outline"
            title="No jobs yet"
            message="Create a job first — it holds the client and the work address."
            action={{ label: 'Create a job', onPress: () => { setJobPickerOpen(false); router.push('/job/new'); } }}
          />
        ) : (
          jobs.items.map((job) => (
            <ListRow
              key={job.id}
              title={job.title}
              subtitle={job.client.fullName}
              meta={job.reference}
              onPress={() => { setJobId(job.id); setJobPickerOpen(false); }}
            />
          ))
        )}
      </Sheet>

      <LineEditor
        visible={adding}
        defaultTaxRateBp={taxSettings.data?.defaultTaxRateBp ?? 0}
        onClose={() => setAdding(false)}
        onSave={(line) => { setLines((current) => [...current, line]); setAdding(false); }}
      />

      {editingIndex !== null ? (
        <LineEditor
          visible
          initial={lines[editingIndex]}
          defaultTaxRateBp={taxSettings.data?.defaultTaxRateBp ?? 0}
          onClose={() => setEditingIndex(null)}
          onSave={(line) => {
            setLines((current) => current.map((item, i) => (i === editingIndex ? line : item)));
            setEditingIndex(null);
          }}
          onDelete={() => {
            setLines((current) => current.filter((_, i) => i !== editingIndex));
            setEditingIndex(null);
          }}
        />
      ) : null}
    </ScreenScroll>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="caption" tone={muted ? 'faint' : 'muted'}>{label}</Text>
      <Text variant="caption" tone={muted ? 'faint' : 'default'}>{value}</Text>
    </View>
  );
}
