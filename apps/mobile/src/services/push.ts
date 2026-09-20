import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';

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

/** Type-only, so importing the types does not pull the module in at runtime. */
type NotificationsModule = typeof import('expo-notifications');

/**
 * Expo Go dropped Android remote push in SDK 53, and `expo-notifications`
 * throws **as it is imported** rather than when it is called.
 *
 * That matters more than it sounds. A static import at the top of this file
 * threw while expo-router was building the route graph, so the router saw an
 * undefined module and the app died on launch with `Cannot read property
 * 'ErrorBoundary' of undefined` — an error naming nothing to do with
 * notifications. No runtime guard can help, because nothing runs: the import
 * is what fails. Hence the lazy `require` below, inside a try/catch.
 *
 * Day-to-day development happens in Expo Go, and a feature nobody can test
 * there must not be able to take the whole app down.
 */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const PUSH_UNAVAILABLE = IN_EXPO_GO && Platform.OS === 'android';

let cached: NotificationsModule | null = null;
let loadFailed = false;

function loadNotifications(): NotificationsModule | null {
  if (PUSH_UNAVAILABLE || loadFailed) return null;
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
    return cached;
  } catch {
    loadFailed = true;
    return null;
  }
}

let handlerInstalled = false;

/** Installs the foreground presentation handler, once, if it can be. */
function installNotificationHandler(notifications: NotificationsModule): void {
  if (handlerInstalled) return;
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerInstalled = true;
  } catch {
    // Unavailable in this runtime. The in-app notification list still works.
  }
}

export interface PushRegistration {
  granted: boolean;
  token: string | null;
  /** Why there is no token, when there is no token. */
  reason?: 'denied' | 'simulator' | 'unsupported' | 'error';
}

export async function registerForPush(): Promise<PushRegistration> {
  const notifications = loadNotifications();
  if (!notifications) {
    if (__DEV__) {
      console.info(
        '[push] Skipped: this runtime has no remote push. Expo Go on Android dropped it in '
        + 'SDK 53 — use a development build to exercise it.',
      );
    }
    return { granted: false, token: null, reason: 'unsupported' };
  }

  // A simulator has no push service to register with; asking produces an
  // error dialog and no token.
  if (!Device.isDevice) return { granted: false, token: null, reason: 'simulator' };

  try {
    installNotificationHandler(notifications);

    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('default', {
        name: 'Ruvik',
        importance: notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const existing = await notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return { granted: false, token: null, reason: 'denied' };

    const token = await notifications.getExpoPushTokenAsync();
    return { granted: true, token: token.data };
  } catch {
    return { granted: false, token: null, reason: 'error' };
  }
}

/**
 * Subscribes to notification taps, if this runtime supports them.
 *
 * Returns a cleanup function either way, so the caller has no special case.
 */
export function onNotificationTapped(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const notifications = loadNotifications();
  if (!notifications) return () => {};

  try {
    installNotificationHandler(notifications);
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      handler(response.notification.request.content.data as Record<string, unknown>);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
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
  const notifications = loadNotifications();
  if (!notifications) return;
  try {
    await notifications.setBadgeCountAsync(0);
  } catch {
    // Badges are unavailable on some Android launchers; never fail for it.
  }
}
