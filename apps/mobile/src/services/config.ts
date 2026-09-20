import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API is.
 *
 * `EXPO_PUBLIC_API_URL` wins whenever it is set — that is the answer for
 * staging and production. In development it is usually absent, and hard-coding
 * `localhost` there is wrong on the one device that matters most: a real phone,
 * for which `localhost` is the phone itself. So the host is taken from the
 * Expo dev server the app was loaded from, which is by definition reachable.
 */

const DEFAULT_PORT = process.env.EXPO_PUBLIC_API_PORT?.trim() || '4000';

/** The dev server address Expo loaded this bundle from, e.g. `192.168.1.5:8081`. */
function devServerHost(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost,
    (Constants.manifest2 as { extra?: { expoGo?: { debuggerHost?: string } } } | undefined)
      ?.extra?.expoGo?.debuggerHost,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      const host = candidate.split('/')[0]?.split(':')[0];
      if (host) return host;
    }
  }
  return null;
}

export function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  if (!__DEV__) {
    // Failing loudly beats shipping a build that quietly talks to nobody.
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. A release build has no dev server to infer the API host from.',
    );
  }

  const host = devServerHost();

  // An Android emulator reaches the host machine at 10.0.2.2; `localhost`
  // there is the emulated device. The iOS simulator shares the host loopback,
  // so `localhost` is correct for it.
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    const fallback = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
    return `http://${fallback}:${DEFAULT_PORT}`;
  }

  return `http://${host}:${DEFAULT_PORT}`;
}

/** The scheme registered in app.json, used to come back from an external checkout. */
export const APP_SCHEME = 'ruvik';
