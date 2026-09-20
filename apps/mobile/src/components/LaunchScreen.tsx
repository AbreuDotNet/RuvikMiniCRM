import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { brand, spacing } from '../theme/tokens';
import { Text } from './ui';

const MARK = require('../../assets/splash-mark.png');

/**
 * The launch screen, drawn rather than shipped as an image.
 *
 * The native splash can only be a centred icon on a flat colour — Android 12
 * removed full-bleed splash images — so the artwork's rings, wordmark and
 * progress bar are rebuilt here in views. Both use the same navy and the same
 * mark, so the handoff from the OS splash to this is invisible.
 *
 * Drawn, not a PNG, for three reasons: it is sharp at every density, the
 * progress bar can actually move, and the composition recentres itself on a
 * tall phone instead of being cropped.
 *
 * The rings are plain Views with a border radius. A circle is a square with
 * half its width as the radius, and an ellipse is that square scaled on one
 * axis — no SVG dependency for four outlines.
 */
export function LaunchScreen({ message }: { message?: string }) {
  const { width, height } = useWindowDimensions();
  const [enter] = useState(() => new Animated.Value(0));
  const [sweep] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Indeterminate on purpose: the app cannot know how long restoring a
    // session takes, and a bar that pretends to know is a bar that stalls at
    // 90%.
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, sweep]);

  const shortest = Math.min(width, height);
  const markSize = Math.round(shortest * 0.34);
  const barWidth = Math.round(shortest * 0.36);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Starting Ruvik'}
      style={{
        flex: 1,
        backgroundColor: brand.navy,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Decoration only — hidden from screen readers, which would otherwise
          announce four unlabelled shapes before the app name. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        {/* Offsets are from the centre of the screen, in multiples of the
            shortest edge, so the composition holds on any aspect ratio.
            The orange ellipse is lifted to sit around the mark rather than
            the whole block — centred on the block it cut across the progress
            bar, which read as a second, broken bar. */}
        <Ring unit={shortest} size={1.66} offsetX={0.62} offsetY={-0.72} />
        <Ring unit={shortest} size={1.34} offsetX={-0.68} offsetY={0.62} />
        <Ring unit={shortest} size={1.02} offsetY={-0.04} />
        <Ring
          unit={shortest}
          size={0.62}
          offsetY={-0.14}
          color={brand.accent}
          opacity={0.8}
          scaleY={0.78}
          rotate="-14deg"
        />
      </View>

      <Animated.View
        style={{
          alignItems: 'center',
          opacity: enter,
          transform: [
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        }}
      >
        <View
          style={{
            width: markSize,
            height: markSize,
            borderRadius: markSize * 0.28,
            overflow: 'hidden',
            backgroundColor: brand.navyDeep,
          }}
        >
          <Image
            source={MARK}
            resizeMode="contain"
            style={{ width: markSize, height: markSize }}
            accessibilityIgnoresInvertColors
          />
        </View>

        <Text
          variant="display"
          style={{ color: brand.onBrand, marginTop: spacing.lg, letterSpacing: 0.5 }}
        >
          Ruvik
        </Text>
        <Text variant="caption" style={{ color: brand.onBrandMuted, marginTop: 2 }}>
          Your local service marketplace
        </Text>

        <View
          style={{
            width: barWidth,
            height: 3,
            borderRadius: 2,
            backgroundColor: brand.track,
            marginTop: spacing.xxl,
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={{
              width: barWidth * 0.4,
              height: 3,
              borderRadius: 2,
              backgroundColor: brand.accent,
              transform: [{
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-barWidth * 0.4, barWidth],
                }),
              }],
            }}
          />
        </View>

        {message ? (
          <Text variant="micro" style={{ color: brand.onBrandMuted, marginTop: spacing.lg }}>
            {message}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** One hairline outline. A circle unless `scaleY` squashes it into an ellipse. */
function Ring({
  unit,
  size,
  offsetX = 0,
  offsetY = 0,
  color = brand.hairline,
  opacity = 1,
  scaleY = 1,
  rotate = '0deg',
}: {
  /** The shortest screen edge. Every other number here is a multiple of it. */
  unit: number;
  size: number;
  offsetX?: number;
  offsetY?: number;
  color?: string;
  opacity?: number;
  scaleY?: number;
  rotate?: string;
}) {
  const diameter = unit * size;
  return (
    <View
      style={{
        position: 'absolute',
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        borderWidth: 1,
        borderColor: color,
        opacity,
        // Translations from centre rather than top/left coordinates: the
        // parent already centres its children, so the artwork stays put on a
        // tall phone and on a short tablet alike.
        transform: [
          { translateX: unit * offsetX },
          { translateY: unit * offsetY },
          { scaleY },
          { rotate },
        ],
      }}
    />
  );
}

/** The brand tile on its own, for the auth header. */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        overflow: 'hidden',
        backgroundColor: brand.navyDeep,
      }}
    >
      <Image
        source={MARK}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
