import * as SecureStore from 'expo-secure-store';

import type { TokenStore } from './apiClient';

const REFRESH_KEY = 'ruvik.refresh-token';

/**
 * The refresh token in the OS keychain — Keychain Services on iOS, the
 * EncryptedSharedPreferences-backed store on Android.
 *
 * Never AsyncStorage: that is a plain file in the app sandbox, readable by
 * anything with filesystem access on a rooted or jailbroken device, and a
 * refresh token is a 30-day credential.
 *
 * The access token is not stored at all. It lives in memory for its fifteen
 * minutes and dies with the process.
 */
export const keychainTokenStore: TokenStore = {
  async getRefreshToken() {
    try {
      return await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      // A keychain read can fail on a device whose secure hardware is locked.
      // Treating that as "no session" sends the user to sign-in, which is
      // recoverable; throwing here would crash the boot sequence.
      return null;
    }
  },

  async setRefreshToken(token: string | null) {
    try {
      if (token === null) {
        await SecureStore.deleteItemAsync(REFRESH_KEY);
        return;
      }
      await SecureStore.setItemAsync(REFRESH_KEY, token, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // Silent: a token we could not persist just means the next cold start
      // asks for a password.
    }
  },
};
