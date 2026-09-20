import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { z } from 'zod';

import {
  Button, Input, ScreenScroll, Stack, Text, useFeedback,
} from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { ApiError } from '../../src/services/apiClient';
import { errorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, spacing } from '../../src/theme/tokens';

/** Mirrors the server's rules so the failure arrives before the round trip. */
const schema = z.object({
  role: z.enum(['customer', 'provider']),
  fullName: z.string().trim().min(2, 'Tell us your name.').max(120),
  email: z.string().trim().min(1, 'Enter your email.').email('That does not look like an email.'),
  password: z.string()
    .min(12, 'Use at least 12 characters.')
    .max(128, 'Use at most 128 characters.'),
  businessName: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
}).refine(
  (v) => v.role !== 'provider' || (v.businessName?.trim().length ?? 0) >= 2,
  { path: ['businessName'], message: 'What is your business called?' },
);

type FormValues = z.infer<typeof schema>;

export default function SignUp() {
  const insets = useSafeAreaInsets();
  const { signup } = useAuth();
  const { notify } = useFeedback();
  const [step, setStep] = useState<0 | 1>(0);
  const [submitting, setSubmitting] = useState(false);

  const { control, handleSubmit, setError, trigger } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      role: 'customer', fullName: '', email: '', password: '', businessName: '', city: '',
    },
  });

  // `useWatch` rather than `watch()`: the latter returns a function React
  // Compiler cannot memoize, so it opts the whole screen out of compilation.
  const role = useWatch({ control, name: 'role' });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await signup({
        email: values.email.trim(),
        password: values.password,
        fullName: values.fullName.trim(),
        role: values.role,
        businessName: values.role === 'provider' ? values.businessName?.trim() : undefined,
        city: values.city?.trim() || undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const ours = new Set<keyof FormValues>([
          'fullName', 'email', 'password', 'businessName', 'city',
        ]);
        const fields = err.fieldErrors();
        let handled = false;
        for (const [field, message] of Object.entries(fields)) {
          if (ours.has(field as keyof FormValues)) {
            setError(field as keyof FormValues, { message });
            handled = true;
          }
        }
        // An email that is already registered comes back as a field error on
        // `email`, so step one is where it needs to be seen.
        if (handled) setStep(0);
        else notify(err.message, 'error');
      } else {
        notify(errorMessage(err), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  });

  const goNext = async () => {
    const valid = await trigger(['role', 'fullName', 'email', 'password']);
    if (valid) setStep(1);
  };

  return (
    <ScreenScroll keyboardAware contentStyle={{ paddingTop: insets.top + spacing.xl }}>
      <Stack gap={spacing.xs}>
        <Text variant="micro" tone="muted" uppercase>Step {step + 1} of 2</Text>
        <ProgressBar step={step} />
        <Text variant="title" accessibilityRole="header" style={{ marginTop: spacing.md }}>
          {step === 0 ? 'Create your account' : role === 'provider' ? 'About your business' : 'Almost there'}
        </Text>
        <Text variant="caption" tone="muted">
          {step === 0
            ? 'You can change any of this later.'
            : role === 'provider'
              ? 'This is what customers will see when they find you.'
              : 'Where you are helps us show you nearby professionals.'}
        </Text>
      </Stack>

      {step === 0 ? (
        <Stack gap={spacing.md}>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Stack gap={spacing.sm}>
                <Text variant="caption" tone="muted">I am</Text>
                <RoleCard
                  icon="search-outline"
                  title="Looking for a professional"
                  description="Find someone, request a quote and pay for the work."
                  selected={field.value === 'customer'}
                  onPress={() => field.onChange('customer')}
                />
                <RoleCard
                  icon="hammer-outline"
                  title="Offering my services"
                  description="Manage clients, jobs, quotes and invoices in one place."
                  selected={field.value === 'provider'}
                  onPress={() => field.onChange('provider')}
                />
              </Stack>
            )}
          />

          <Controller
            control={control}
            name="fullName"
            render={({ field, fieldState }) => (
              <Input
                label="Your name"
                placeholder="Ana Torres"
                autoComplete="name"
                textContentType="name"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <Input
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <Input
                label="Password"
                placeholder="At least 12 characters"
                hint="Long beats complicated. A short phrase you will remember is fine."
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secure
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />

          <Button label="Continue" icon="arrow-forward" iconPosition="right" onPress={() => void goNext()} />
        </Stack>
      ) : (
        <Stack gap={spacing.md}>
          {role === 'provider' ? (
            <Controller
              control={control}
              name="businessName"
              render={({ field, fieldState }) => (
                <Input
                  label="Business name"
                  placeholder="Torres Drywall"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          ) : null}

          <Controller
            control={control}
            name="city"
            render={({ field, fieldState }) => (
              <Input
                label="City"
                placeholder="Austin"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />

          <Button label="Create account" loading={submitting} onPress={() => void onSubmit()} />
          <Button label="Back" variant="ghost" disabled={submitting} onPress={() => setStep(0)} />
        </Stack>
      )}

      <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Button
          label="I already have an account"
          variant="ghost"
          fullWidth={false}
          onPress={() => router.replace('/(auth)/sign-in')}
        />
      </View>
    </ScreenScroll>
  );
}

function ProgressBar({ step }: { step: number }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: 2, now: step + 1 }}
      style={{ flexDirection: 'row', gap: spacing.xs }}
    >
      {[0, 1].map((index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: index <= step ? theme.colors.primary : theme.colors.border,
          }}
        />
      ))}
    </View>
  );
}

function RoleCard({
  icon, title, description, selected, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={description}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
      }}
    >
      <Ionicons
        name={icon}
        size={24}
        color={selected ? theme.colors.primary : theme.colors.textMuted}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="micro" tone="muted">{description}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? theme.colors.primary : theme.colors.borderStrong}
      />
    </Pressable>
  );
}
