import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner, Button, Chip, Input, Sheet, Stack, Text,
} from '../../components/ui';
import { spacing } from '../../theme/tokens';
import { centsToInput, parseAmountToCents, parseQuantity, parseRateToBp, bpToInput } from '../../utils/moneyInput';
import { LINE_KIND_LABELS, TAX_TREATMENT_LABELS } from '../../utils/status';
import type { LineInput, LineKind, TaxTreatment } from '../../types/api';

const KINDS: LineKind[] = ['labour', 'materials', 'equipment', 'fee', 'reimbursement', 'deposit', 'other'];
const TREATMENTS: TaxTreatment[] = ['taxable', 'not_subject', 'exempt', 'manual_adjustment'];

/**
 * One line of a quote or invoice.
 *
 * Two fields here exist because of US sales tax on work done to real
 * property, not because a form looked empty:
 *
 * - **Kind** splits labour from materials. Most states treat the two
 *   differently on a building job, and a free-text description cannot carry
 *   that distinction to a PDF an auditor reads.
 * - **Treatment** records *why* a line carries no tax. "Exempt" (in scope,
 *   relieved — usually by a certificate the seller must retain) and "not
 *   subject" (outside the tax's scope, such as labour on residential real
 *   property in Texas) are different answers to different questions.
 *
 * The server refuses any non-taxable line without a reason, so the reason
 * field appears the moment one is chosen rather than after a rejected save.
 */
export function LineEditor({
  visible,
  initial,
  defaultTaxRateBp,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  initial?: LineInput;
  defaultTaxRateBp: number;
  onClose: () => void;
  onSave: (line: LineInput) => void;
  onDelete?: () => void;
}) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '1');
  const [unitPrice, setUnitPrice] = useState(
    initial ? centsToInput(initial.unitPriceCents) : '',
  );
  const [rate, setRate] = useState(
    bpToInput(initial?.taxRateBp ?? defaultTaxRateBp),
  );
  const [kind, setKind] = useState<LineKind>(initial?.lineKind ?? 'labour');
  const [treatment, setTreatment] = useState<TaxTreatment>(initial?.taxTreatment ?? 'taxable');
  const [reason, setReason] = useState(initial?.taxReason ?? '');
  const [certificate, setCertificate] = useState(initial?.taxExemptionCertificate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsReason = treatment !== 'taxable';

  const save = () => {
    const next: Record<string, string> = {};

    if (description.trim().length < 1) next.description = 'Say what this line is for.';
    const qty = parseQuantity(quantity);
    if (qty.error) next.quantity = qty.error;
    const price = parseAmountToCents(unitPrice);
    if (price.error) next.unitPrice = price.error;
    const bp = parseRateToBp(rate);
    if (bp.error) next.rate = bp.error;
    if (needsReason && !reason.trim()) {
      next.reason = treatment === 'manual_adjustment'
        ? 'Say what you adjusted and why. A hand-set figure has to be attributable.'
        : 'Say why this line is not taxed.';
    }

    setErrors(next);
    if (Object.keys(next).length) return;

    onSave({
      description: description.trim(),
      quantity: qty.value!,
      unitPriceCents: price.cents!,
      taxRateBp: bp.bp ?? 0,
      taxTreatment: treatment,
      lineKind: kind,
      taxReason: reason.trim() || null,
      taxExemptionCertificate: certificate.trim() || null,
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={initial ? 'Edit line' : 'Add a line'}
      subtitle="Totals are recalculated by the server when you save the document."
    >
      <Input
        label="Description"
        placeholder="Installation and finishing labour"
        value={description}
        onChangeText={setDescription}
        error={errors.description}
      />

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Input
          containerStyle={{ flex: 1 }}
          label="Quantity"
          placeholder="1"
          keyboardType="decimal-pad"
          value={quantity}
          onChangeText={setQuantity}
          error={errors.quantity}
        />
        <Input
          containerStyle={{ flex: 1.4 }}
          label="Unit price"
          placeholder="450.00"
          keyboardType="decimal-pad"
          leftIcon="cash-outline"
          value={unitPrice}
          onChangeText={setUnitPrice}
          error={errors.unitPrice}
        />
      </View>

      <Stack gap={spacing.sm}>
        <Text variant="caption" tone="muted">What kind of line is this?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {KINDS.map((option) => (
            <Chip
              key={option}
              label={LINE_KIND_LABELS[option] ?? option}
              selected={kind === option}
              onPress={() => setKind(option)}
            />
          ))}
        </View>
      </Stack>

      <Stack gap={spacing.sm}>
        <Text variant="caption" tone="muted">Tax treatment</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TREATMENTS.map((option) => (
            <Chip
              key={option}
              label={TAX_TREATMENT_LABELS[option] ?? option}
              selected={treatment === option}
              onPress={() => setTreatment(option)}
            />
          ))}
        </View>
      </Stack>

      <Input
        label="Tax rate"
        placeholder="8.25"
        keyboardType="decimal-pad"
        hint={
          treatment === 'taxable' || treatment === 'manual_adjustment'
            ? 'The combined state and local rate where the work happens.'
            : 'Kept on record, but no tax is charged on this line.'
        }
        value={rate}
        onChangeText={setRate}
        error={errors.rate}
      />

      {needsReason ? (
        <>
          <Banner
            tone="info"
            message={
              treatment === 'exempt'
                ? 'Exempt means in scope but relieved — usually by a certificate you have to keep.'
                : treatment === 'not_subject'
                  ? 'Not subject means outside the tax altogether, such as labour on residential real property in Texas.'
                  : 'A manual adjustment still charges tax. The note should say what you overrode and why.'
            }
          />
          <Input
            label="Reason"
            placeholder="Labour on residential real property is not subject to Texas sales tax"
            multiline
            numberOfLines={3}
            value={reason}
            onChangeText={setReason}
            error={errors.reason}
          />
          {treatment === 'exempt' ? (
            <Input
              label="Certificate reference"
              placeholder="ST-124 on file"
              hint="Where a state requires one — New York's ST-124, a resale certificate elsewhere."
              value={certificate}
              onChangeText={setCertificate}
            />
          ) : null}
        </>
      ) : null}

      <Button label={initial ? 'Save line' : 'Add line'} onPress={save} />
      {onDelete ? (
        <Button label="Remove this line" variant="danger" onPress={onDelete} />
      ) : null}
    </Sheet>
  );
}
