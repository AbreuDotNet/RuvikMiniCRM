import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { RequireRole } from '../../src/components/Guard';
import {
  Badge, Banner, Button, Card, Divider, EmptyState, Input, ListRow, ScreenScroll,
  SectionHeader, Segmented, Sheet, SkeletonList, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { LineEditor } from '../../src/features/quotes/LineEditor';
import { useCreateInvoice, useInvoiceableQuotes } from '../../src/features/invoices/hooks';
import { useJobs } from '../../src/features/crm/hooks';
import { useTaxSettings } from '../../src/features/provider/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { formatDate, formatMoney, toIsoDate } from '../../src/utils/format';
import { computeTotals } from '../../src/utils/money';
import { LINE_KIND_LABELS } from '../../src/utils/status';
import type { LineInput } from '../../src/types/api';

export default function NewInvoiceRoute() {
  return (
    <RequireRole role="provider">
      <NewInvoice />
    </RequireRole>
  );
}

function NewInvoice() {
  const params = useLocalSearchParams<{ quoteId?: string; jobId?: string }>();
  const { notify } = useFeedback();
  const createInvoice = useCreateInvoice();

  const [mode, setMode] = useState<'quote' | 'scratch'>(
    params.jobId && !params.quoteId ? 'scratch' : 'quote',
  );
  const [quoteId, setQuoteId] = useState<string | undefined>(params.quoteId);
  const [jobId, setJobId] = useState<string | undefined>(params.jobId);
  const [lines, setLines] = useState<LineInput[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dueDays, setDueDays] = useState('14');
  const [notes, setNotes] = useState('');

  const quotes = useInvoiceableQuotes();
  const jobs = useJobs({});
  const taxSettings = useTaxSettings();

  const selectedQuote = quotes.data?.find((quote) => quote.id === quoteId);
  const selectedJob = jobs.items.find((job) => job.id === jobId);

  const totals = useMemo(
    () => computeTotals(
      lines.map((line) => ({
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        taxRateBp: line.taxRateBp,
        taxTreatment: line.taxTreatment,
      })),
    ),
    [lines],
  );

  const dueDate = useMemo(() => {
    const days = Number(dueDays);
    if (!Number.isFinite(days) || days < 0) return null;
    const date = new Date();
    date.setDate(date.getDate() + Math.trunc(days));
    return toIsoDate(date);
  }, [dueDays]);

  const canSubmit = mode === 'quote' ? Boolean(quoteId) : Boolean(jobId) && lines.length > 0;

  const submit = async () => {
    try {
      const created = await createInvoice.mutateAsync(
        mode === 'quote'
          ? { fromQuoteId: quoteId, dueDate, notes: notes.trim() || null }
          : { jobId, lines, dueDate, notes: notes.trim() || null },
      );
      notify(`Invoice ${created.number} created.`, 'success');
      router.replace({ pathname: '/invoice/[id]', params: { id: created.id } });
    } catch (err) {
      // A 409 here is usually "this quote is already invoiced" — the server's
      // wording says which, and repeating it beats inventing a guess.
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">New invoice</Text>
        <Text variant="caption" tone="muted">
          Invoicing an accepted quote carries its exact figures across, agreed and unchanged.
        </Text>
      </Stack>

      <Segmented
        options={[
          { value: 'quote' as const, label: 'From a quote' },
          { value: 'scratch' as const, label: 'From scratch' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'quote' ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Accepted quotes" />
          {quotes.isPending ? (
            <SkeletonList rows={2} />
          ) : !quotes.data?.length ? (
            <Card>
              <EmptyState
                icon="document-text-outline"
                title="No quote to invoice"
                message="An invoice can only be raised from a quote the customer has accepted and that has not been invoiced yet."
                action={{ label: 'Start from scratch', onPress: () => setMode('scratch') }}
              />
            </Card>
          ) : (
            <Card padded={false}>
              {quotes.data.map((quote, index) => (
                <View key={quote.id}>
                  {index > 0 ? <Divider inset={spacing.lg} /> : null}
                  <ListRow
                    title={formatMoney(quote.totalCents, quote.currency)}
                    subtitle={`${quote.number} · ${quote.clientName}`}
                    meta={quote.job.title}
                    trailing={
                      quoteId === quote.id ? <Badge label="Selected" tone="primary" /> : undefined
                    }
                    onPress={() => setQuoteId(quote.id)}
                  />
                </View>
              ))}
            </Card>
          )}

          {selectedQuote ? (
            <Banner
              tone="info"
              message={`The invoice will carry ${selectedQuote.number}'s lines and totals exactly as the customer accepted them.`}
            />
          ) : null}
        </Stack>
      ) : (
        <>
          <Stack gap={spacing.sm}>
            <SectionHeader title="Job" />
            <Card padded={false}>
              <ListRow
                title={selectedJob ? selectedJob.title : 'Choose a job'}
                subtitle={selectedJob ? selectedJob.client.fullName : 'The job carries the client and the address'}
                meta={selectedJob?.reference}
                onPress={() => setPickerOpen(true)}
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
                  message="Add what you are charging for."
                  action={{ label: 'Add a line', onPress: () => setAdding(true) }}
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
                      onPress={() => setEditingIndex(index)}
                    />
                  </View>
                ))}
              </Card>
            )}
          </Stack>

          {lines.length ? (
            <Card>
              <Stack gap={spacing.xs}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="caption" tone="muted">Subtotal</Text>
                  <Text variant="caption">{formatMoney(totals.subtotalCents)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="caption" tone="muted">Sales tax</Text>
                  <Text variant="caption">{formatMoney(totals.taxCents)}</Text>
                </View>
                <Divider />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
                  <Text variant="heading">Total</Text>
                  <Text variant="title">{formatMoney(totals.totalCents)}</Text>
                </View>
                <Text variant="micro" tone="faint">
                  A preview. The server recalculates these figures on save.
                </Text>
              </Stack>
            </Card>
          ) : null}
        </>
      )}

      <Input
        label="Payment terms"
        placeholder="14"
        keyboardType="number-pad"
        hint={dueDate ? `Due ${formatDate(dueDate)}.` : 'Days from today until payment is due.'}
        value={dueDays}
        onChangeText={setDueDays}
      />

      <Input
        label="Notes on the invoice"
        placeholder="Thank you for your business."
        multiline
        numberOfLines={3}
        value={notes}
        onChangeText={setNotes}
      />

      <Button
        label="Create invoice"
        disabled={!canSubmit}
        loading={createInvoice.isPending}
        haptic
        onPress={() => void submit()}
      />

      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Which job?">
        {jobs.isPending ? (
          <Text variant="caption" tone="muted">Loading…</Text>
        ) : !jobs.items.length ? (
          <EmptyState
            icon="briefcase-outline"
            title="No jobs yet"
            message="Create a job first."
            action={{
              label: 'Create a job',
              onPress: () => { setPickerOpen(false); router.push('/job/new'); },
            }}
          />
        ) : (
          jobs.items.map((job) => (
            <ListRow
              key={job.id}
              title={job.title}
              subtitle={job.client.fullName}
              meta={job.reference}
              onPress={() => { setJobId(job.id); setPickerOpen(false); }}
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
