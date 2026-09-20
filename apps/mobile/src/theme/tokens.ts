/**
 * Design tokens.
 *
 * One scale, two palettes. Components never reach for a raw hex — they take
 * colours from the theme so light and dark stay in step, and so a future
 * white-label only has to touch this file.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Minimum touch target. WCAG 2.5.5 asks for 44x44; anything smaller is a
 * button that only works for people with steady hands and small fingers.
 */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '650' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
} as const;

export type TypographyKey = keyof typeof typography;

interface Palette {
  /** Page background, behind everything. */
  canvas: string;
  /** Raised surface: cards, sheets, inputs. */
  surface: string;
  /** A surface on a surface — a nested row or a quiet chip. */
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Text on top of `primary`. */
  onPrimary: string;
  primary: string;
  primaryMuted: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;
  info: string;
  infoMuted: string;
  /** Scrim behind a modal or sheet. */
  scrim: string;
  skeleton: string;
}

export const lightPalette: Palette = {
  canvas: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F7',
  border: '#E3E7EE',
  borderStrong: '#C9D1DE',
  text: '#101828',
  textMuted: '#5A6478',
  textFaint: '#8B94A6',
  onPrimary: '#FFFFFF',
  primary: '#1D4ED8',
  primaryMuted: '#E6EDFD',
  success: '#087443',
  successMuted: '#E2F5EB',
  warning: '#94600A',
  warningMuted: '#FCF2DC',
  danger: '#B42318',
  dangerMuted: '#FDECEA',
  info: '#0B5C8A',
  infoMuted: '#E2F1F9',
  scrim: 'rgba(16, 24, 40, 0.45)',
  skeleton: '#E7EAF0',
};

export const darkPalette: Palette = {
  canvas: '#0B1220',
  surface: '#141C2B',
  surfaceMuted: '#1C2637',
  border: '#27324A',
  borderStrong: '#3A4762',
  text: '#F2F5FA',
  textMuted: '#A3AEC4',
  textFaint: '#7B87A0',
  onPrimary: '#FFFFFF',
  primary: '#5B8DEF',
  primaryMuted: '#1B2942',
  success: '#4ADE80',
  successMuted: '#14301F',
  warning: '#FBBF43',
  warningMuted: '#33270B',
  danger: '#FF7B72',
  dangerMuted: '#391715',
  info: '#6BC6F5',
  infoMuted: '#0E2A38',
  scrim: 'rgba(0, 0, 0, 0.6)',
  skeleton: '#1E2839',
};

export type ThemeColors = Palette;

export interface Theme {
  mode: 'light' | 'dark';
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
}

export const lightTheme: Theme = {
  mode: 'light', colors: lightPalette, spacing, radius, typography,
};
export const darkTheme: Theme = {
  mode: 'dark', colors: darkPalette, spacing, radius, typography,
};
