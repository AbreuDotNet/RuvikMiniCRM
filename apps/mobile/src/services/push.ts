import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/**
 * Push notifications.
 *
 * The device half is real: permission, the Android channel, the Expo push
 * token, and the tap handler that routes into the app.
 *
 * The server half does not exist yet. There is no endpoint on the Ruvik API
 * that stores a device token, so `registerDeviceToken` deliberately does not
 * call one — inventing a route here would produce a 404 on every launch and
 * an app that looks wired up when it is not. When the endpoint lands, that one
 * function is the only thing that changes.
 *
 * Until then the app keeps its unread badge current by polling
 * `/notifications`, which is a real endpoint and works today.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushRegistration {
  granted: boolean;
  token: string | null;
  /** Why there is no token, when there is no token. */
  reason?: 'denied' | 'simulator' | 'unsupported' | 'error';
}

export async function registerForPush(): Promise<PushRegistration> {
  // A simulator has no push service to register with; asking produces an
  // error dialog and no token.
  if (!Device.isDevice) return { granted: false, token: null, reason: 'simulator' };

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Ruvik',
        importance: Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return { granted: false, token: null, reason: 'denied' };

    const token = await Notifications.getExpoPushTokenAsync();
    return { granted: true, token: token.data };
  } catch {
    return { granted: false, token: null, reason: 'error' };
  }
}

/**
 * Where the device token will be sent once the API can receive it.
 *
 * Intentionally inert. See the note at the top of this file: a fabricated
 * endpoint is worse than an honest gap.
 */
export async function registerDeviceToken(_token: string): Promise<void> {
  if (__DEV__) {
    console.warn(
      '[push] Device token obtained but not sent: the Ruvik API has no endpoint to store it yet.',
    );
  }
}

/** Clears the app icon badge, e.g. once the notifications screen is read. */
export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Badges are unavailable on some Android launchers; never fail for it.
  }
}
