import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { z } from 'zod';

import { AuthScaffold, StepIndicator } from '../../src/components/AuthScaffold';
import { Button, Input, Reveal, Stack, Text, useFeedback } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { errorMessage } from '../../src/services/api';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius, spacing } from '../../src/theme/tokens';
import { applyFieldErrors } from '../../src/utils/forms';

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

const STEPS = 3;

export default function SignUp() {
  const { signup } = useAuth();
  const { notify } = useFeedback();
  const [step, setStep] = useState(0);
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
      const placed = applyFieldErrors(err, setError, [
        'fullName', 'email', 'password', 'businessName', 'city',
      ]);
      // An email that is already registered comes back as a field error on
      // `email`, which lives on step two — so go back to where it can be seen.
      if (placed) setStep(1);
      else notify(errorMessage(err), 'error');
    } finally {
      setSubmitting(false);
    }
  });

  const next = async () => {
    const fields: Record<number, (keyof FormValues)[]> = {
      0: ['role'],
      1: ['fullName', 'email', 'password'],
    };
    const valid = await trigger(fields[step] ?? []);
    if (valid) setStep((current) => Math.min(current + 1, STEPS - 1));
  };

  const back = () => {
    if (step === 0) router.back();
    else setStep((current) => current - 1);
  };

  const copy = [
    {
      title: 'How will you use Ruvik?',
      subtitle: 'This decides what the app shows you. You can only pick one.',
    },
    {
      title: 'Create your account',
      subtitle: 'You can change any of this later.',
    },
    {
      title: role === 'provider' ? 'About your business' : 'Where are you?',
      subtitle: role === 'provider'
        ? 'This is what customers see when they find you.'
        : 'It helps us show you nearby professionals.',
    },
  ][step]!;

  return (
    <AuthScaffold
      title={copy.title}
      subtitle={copy.subtitle}
      onBack={back}
      eyebrow={<StepIndicator step={step} total={STEPS} />}
      footer={
        step === 0 ? (
          <Button
            label="I already have an account"
            variant="ghost"
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        ) : undefined
      }
    >
      {/* Keyed on the step so each one animates in as it arrives, rather than
          the fields silently swapping under the same heading. */}
      <Reveal key={step}>
        {step === 0 ? (
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Stack gap={spacing.md}>
                <RoleCard
                  icon="search-outline"
                  title="I am looking for a professional"
                  description="Find someone nearby, ask for a quote, and pay for the work."
                  selected={field.value === 'customer'}
                  onPress={() => field.onChange('customer')}
                />
                <RoleCard
                  icon="hammer-outline"
                  title="I offer my services"
                  description="Run clients, jobs, quotes and invoices from your phone."
                  selected={field.value === 'provider'}
                  onPress={() => field.onChange('provider')}
                />
              </Stack>
            )}
          />
        ) : step === 1 ? (
          <Stack gap={spacing.md}>
            <Controller
              control={control}
              name="fullName"
              render={({ field, fieldState }) => (
                <Input
                  label="Your name"
                  placeholder="Ana Torres"
                  autoComplete="name"
                  textContentType="name"
                  leftIcon="person-outline"
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
                  leftIcon="mail-outline"
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
                  leftIcon="lock-closed-outline"
                  secure
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
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
                    leftIcon="storefront-outline"
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
                  leftIcon="location-outline"
                  value={field.value ?? ''}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
          </Stack>
        )}
      </Reveal>

      {step < STEPS - 1 ? (
        <Button
          label="Continue"
          icon="arrow-forward"
          iconPosition="right"
          onPress={() => void next()}
        />
      ) : (
        <Button
          label="Create account"
          icon="checkmark"
          iconPosition="right"
          loading={submitting}
          haptic
          onPress={() => void onSubmit()}
        />
      )}
    </AuthScaffold>
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
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.primary : theme.colors.border,
        backgroundColor: selected ? theme.colors.primaryMuted : theme.colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
        }}
      >
        <Ionicons
          name={icon}
          size={20}
          color={selected ? theme.colors.onPrimary : theme.colors.textMuted}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="micro" tone="muted">{description}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? theme.colors.primary : theme.colors.borderStrong}
        style={{ marginTop: 2 }}
      />
    </Pressable>
  );
}
