import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { typography, type TypographyKey } from '../../theme/tokens';

export type TextTone =
  | 'default' | 'muted' | 'faint' | 'primary'
  | 'success' | 'warning' | 'danger' | 'info' | 'onPrimary';

export interface TextProps extends RNTextProps {
  variant?: TypographyKey;
  tone?: TextTone;
  align?: TextStyle['textAlign'];
  /** Uppercase eyebrow styling for section labels. */
  uppercase?: boolean;
}

/**
 * Every string on screen goes through here.
 *
 * Two reasons: colours come from the theme rather than a literal, and
 * `allowFontScaling` stays on. Turning it off is the usual way a "pixel
 * perfect" screen becomes unreadable for someone using Larger Text.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  align,
  uppercase,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  const color = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    faint: theme.colors.textFaint,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    info: theme.colors.info,
    onPrimary: theme.colors.onPrimary,
  }[tone];

  const base = typography[variant];

  return (
    <RNText
      allowFontScaling
      // Past this the layout breaks rather than helping; the cap is generous.
      maxFontSizeMultiplier={1.6}
      style={[
        {
          color,
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          fontWeight: base.fontWeight as TextStyle['fontWeight'],
          textAlign: align,
          letterSpacing: uppercase ? 0.6 : undefined,
        },
        uppercase ? { textTransform: 'uppercase' } : null,
        style,
      ]}
      {...rest}
    />
  );
}
