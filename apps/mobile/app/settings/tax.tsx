import { useState } from 'react';

import { RequireRole } from '../../src/components/Guard';
import {
  Banner, Button, Card, ErrorState, Input, ScreenScroll, SkeletonList,
  Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useTaxSettings, useUpdateTaxSettings } from '../../src/features/provider/hooks';
import { errorMessage } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';
import { bpToInput, parseRateToBp } from '../../src/utils/moneyInput';
import type { TaxSettings as TaxSettingsPayload } from '../../src/types/api';

export default function TaxSettingsRoute() {
  return (
    <RequireRole role="provider">
      <TaxSettings />
    </RequireRole>
  );
}

/**
 * The provider's default sales-tax setup.
 *
 * A default, not a rule. Rate and treatment are set per line on each document,
 * because a single job can mix taxable materials with labour that is outside
 * the tax altogether — and because the right answer depends on the state, the
 * locality, the type of work and the business itself.
 */
function TaxSettings() {
  const settings = useTaxSettings();

  if (settings.isPending) {
    return <ScreenScroll><SkeletonList rows={2} /></ScreenScroll>;
  }
  if (settings.isError || !settings.data) {
    return (
      <ScreenScroll>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </ScreenScroll>
    );
  }

  return <TaxSettingsForm initial={settings.data} />;
}

function TaxSettingsForm({ initial }: { initial: TaxSettingsPayload }) {
  const { notify } = useFeedback();
  const update = useUpdateTaxSettings();

  const [state, setState] = useState(initial.taxState ?? '');
  const [rate, setRate] = useState(bpToInput(initial.defaultTaxRateBp));
  const [note, setNote] = useState(initial.jurisdictionNote ?? '');

  const parsedRate = parseRateToBp(rate);
  const stateValid = state.trim().length === 0 || /^[A-Za-z]{2}$/.test(state.trim());

  const save = async () => {
    try {
      await update.mutateAsync({
        taxState: state.trim() ? state.trim().toUpperCase() : null,
        defaultTaxRateBp: parsedRate.bp ?? 0,
        jurisdictionNote: note.trim() || null,
      });
      notify('Tax settings saved.', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <ScreenScroll keyboardAware>
      <Stack gap={spacing.xs}>
        <Text variant="title" accessibilityRole="header">Tax settings</Text>
        <Text variant="caption" tone="muted">
          Where new quote and invoice lines start. Every line can still be set individually.
        </Text>
      </Stack>

      <Input
        label="State you work in"
        placeholder="TX"
        autoCapitalize="characters"
        maxLength={2}
        hint="The two-letter code. Sales tax is sourced to where the job is, not where you are."
        error={stateValid ? undefined : 'Use the two-letter state code, e.g. TX.'}
        value={state}
        onChangeText={setState}
      />

      <Input
        label="Default rate"
        placeholder="8.25"
        keyboardType="decimal-pad"
        hint="The combined state and local rate you charge most often."
        error={rate ? parsedRate.error : undefined}
        value={rate}
        onChangeText={setRate}
      />

      <Input
        label="Note for yourself"
        placeholder="Separated contracts: materials taxed, labour not."
        multiline
        numberOfLines={3}
        value={note}
        onChangeText={setNote}
      />

      <Banner
        tone="warning"
        title="This is a starting point, not tax advice"
        message={
          'Whether a job is taxable, and at what rate, depends on the state, the locality, the '
          + 'kind of work, whether materials are separated from labour, and how your business is '
          + 'registered. Ruvik cannot decide that for you — check with a CPA or your state '
          + 'revenue department.'
        }
      />

      <Card>
        <Stack gap={spacing.sm}>
          <Text variant="heading">Why lines carry their own treatment</Text>
          <Text variant="caption" tone="muted">
            Work on real property splits differently in every state. Texas does not tax labour on
            residential property; New York distinguishes a capital improvement from a repair;
            Arizona taxes a share of the contract rather than the materials. One rate for the
            whole document cannot express any of that, so each line says what it is and why.
          </Text>
        </Stack>
      </Card>

      <Button
        label="Save"
        disabled={!stateValid || Boolean(rate && parsedRate.error)}
        loading={update.isPending}
        onPress={() => void save()}
      />
    </ScreenScroll>
  );
}
