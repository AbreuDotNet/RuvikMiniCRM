import * as Crypto from 'expo-crypto';

import { ApiClient, ApiError } from './apiClient';
import { resolveApiBaseUrl } from './config';
import { keychainTokenStore } from './secureStore';

let sessionLostHandler: (() => void) | null = null;

/**
 * The one client the whole app shares.
 *
 * One instance matters: the refresh serialisation inside it is per-instance,
 * and a second client would happily present the same single-use refresh token
 * in parallel with the first — which the server reads as theft.
 */
export const api = new ApiClient({
  baseUrl: resolveApiBaseUrl(),
  store: keychainTokenStore,
  onSessionLost: () => sessionLostHandler?.(),
});

export function setSessionLostHandler(handler: (() => void) | null): void {
  sessionLostHandler = handler;
}

/**
 * A fresh key per attempt at a money-moving call.
 *
 * Generated once when the user presses the button and reused across retries,
 * so a flaky network cannot record the same payment twice. A new key per retry
 * would defeat the entire mechanism.
 */
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

export { ApiError };
export type { ApiErrorDetail } from './apiClient';

/** A message worth showing a human, whatever was thrown. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
