import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { ApiError } from '../services/apiClient';

/**
 * Turns the API's `details` array into inline form errors.
 *
 * The server's messages are written for the person filling in the form and
 * are more specific than anything the client could infer, so they are shown
 * verbatim. Only fields the form actually owns are accepted — a message
 * attached to a field that is not on screen would otherwise vanish.
 *
 * Returns false when nothing could be placed, which is the caller's cue to
 * show the error somewhere the person will see it.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError)) return false;

  const owned = new Set<string>(fields as readonly string[]);
  let placed = false;

  for (const [field, message] of Object.entries(error.fieldErrors())) {
    if (!owned.has(field)) continue;
    setError(field as Path<T>, { message });
    placed = true;
  }

  return placed;
}
