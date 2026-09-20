import { View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { formatMoney, formatRateBp } from '../utils/format';
import { LINE_KIND_LABELS, TAX_TREATMENT_LABELS } from '../utils/status';
import type { DocumentLine } from '../types/api';
import { Card, Divider, Stack, Text } from './ui';

/**
 * A quote or an invoice, rendered the same way.
 *
 * Both documents share this so the customer cannot be shown one arrangement
 * of the numbers in the app and another in the PDF. Every figure here comes
 * from the server; nothing is recomputed on the way to the screen.
 */
export function DocumentLines({
  lines,
  currency,
}: {
  lines: DocumentLine[];
  currency: string;
}) {
  const theme = useTheme();

  return (
    <Card padded={false}>
      {lines.map((line, index) => (
        <View key={`${line.description}-${index}`}>
          {index > 0 ? <Divider inset={spacing.lg} /> : null}
          <View style={{ padding: spacing.lg, gap: 4 }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{line.description}</Text>
              <Text variant="bodyStrong">{formatMoney(line.lineTotalCents, currency)}</Text>
            </View>

            <Text variant="micro" tone="faint">
              {formatQuantity(line.quantity)} × {formatMoney(line.unitPriceCents, currency)}
              {line.lineKind && line.lineKind !== 'other'
                ? ` · ${LINE_KIND_LABELS[line.lineKind] ?? line.lineKind}`
                : ''}
            </Text>

            {/* Why a line carries no tax is part of the document, not a
                footnote: it is the answer an auditor asks for, and the
                customer is entitled to see it too. */}
            {line.taxTreatment && line.taxTreatment !== 'taxable' ? (
              <View style={{ gap: 2, marginTop: 2 }}>
                <Text variant="micro" style={{ color: theme.colors.info }}>
                  {TAX_TREATMENT_LABELS[line.taxTreatment] ?? line.taxTreatment}
                </Text>
                {line.taxReason ? (
                  <Text variant="micro" tone="muted">{line.taxReason}</Text>
                ) : null}
                {line.taxExemptionCertificate ? (
                  <Text variant="micro" tone="muted">
                    Certificate {line.taxExemptionCertificate}
                  </Text>
                ) : null}
              </View>
            ) : line.taxRateBp > 0 ? (
              <Text variant="micro" tone="faint">
                Tax at {formatRateBp(line.taxRateBp)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

export function DocumentTotals({
  currency,
  subtotalCents,
  discountCents,
  taxCents,
  totalCents,
  taxableBaseCents,
  untaxedBaseCents,
  taxJurisdiction,
  amountPaidCents,
  balanceCents,
}: {
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  taxableBaseCents?: number;
  untaxedBaseCents?: number;
  taxJurisdiction?: string | null;
  amountPaidCents?: number;
  balanceCents?: number;
}) {
  const theme = useTheme();

  return (
    <Card>
      <Stack gap={spacing.xs}>
        <Line label="Subtotal" value={formatMoney(subtotalCents, currency)} />
        {discountCents > 0 ? (
          <Line label="Discount" value={`-${formatMoney(discountCents, currency)}`} tone="success" />
        ) : null}

        {typeof taxableBaseCents === 'number' && typeof untaxedBaseCents === 'number'
          && untaxedBaseCents > 0 ? (
          <>
            <Line label="Taxed base" value={formatMoney(taxableBaseCents, currency)} muted />
            <Line label="Untaxed base" value={formatMoney(untaxedBaseCents, currency)} muted />
          </>
        ) : null}

        <Line
          label={taxJurisdiction ? `Sales tax (${taxJurisdiction})` : 'Sales tax'}
          value={formatMoney(taxCents, currency)}
        />

        <Divider />

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingTop: spacing.xs,
          }}
        >
          <Text variant="heading">Total</Text>
          <Text variant="title">{formatMoney(totalCents, currency)}</Text>
        </View>

        {typeof amountPaidCents === 'number' && amountPaidCents > 0 ? (
          <>
            <Line label="Paid" value={formatMoney(amountPaidCents, currency)} tone="success" />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <Text variant="bodyStrong">Balance due</Text>
              <Text
                variant="heading"
                style={{
                  color: (balanceCents ?? 0) > 0 ? theme.colors.warning : theme.colors.success,
                }}
              >
                {formatMoney(balanceCents ?? 0, currency)}
              </Text>
            </View>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

function Line({
  label, value, tone, muted,
}: {
  label: string;
  value: string;
  tone?: 'success';
  muted?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <Text variant="caption" tone={muted ? 'faint' : 'muted'}>{label}</Text>
      <Text variant="caption" tone={tone === 'success' ? 'success' : muted ? 'faint' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

/** Trims the trailing zeros a quantity like `4.000` would otherwise print. */
function formatQuantity(quantity: number): string {
  if (Number.isInteger(quantity)) return String(quantity);
  return String(Number(quantity.toFixed(3)));
}
