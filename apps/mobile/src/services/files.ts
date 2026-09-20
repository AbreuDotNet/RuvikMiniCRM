import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';

import { api } from './api';
import { ApiError } from './apiClient';

/**
 * File transfer.
 *
 * Uploads and downloads go through the native task API rather than `fetch`,
 * so a 6MB photo streams from disk instead of being read into JS memory as a
 * base64 string first — which is how an upload takes an app down on an older
 * Android device.
 */

export type UploadKind = 'image' | 'logo' | 'document';

export interface UploadInput {
  /** Local `file://` URI from the picker. */
  uri: string;
  mimeType: string;
  filename?: string;
  kind: UploadKind;
  caption?: string;
}

export interface UploadedFile {
  id: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  message: string;
}

/**
 * Sends a file to `/files/uploads` as a raw body, which is what that endpoint
 * expects — the media type is the `Content-Type`, not a multipart part.
 *
 * The server verifies the type by magic bytes and quarantines the file until
 * it has been scanned, so a lying `Content-Type` buys nothing.
 *
 * Note the endpoint is provider-only. A customer calling it gets a 403, which
 * is the server being right rather than a bug to work around.
 */
export async function uploadFile(input: UploadInput, retried = false): Promise<UploadedFile> {
  const token = api.getAccessToken();
  if (!token) throw new ApiError(401, {});

  const query = new URLSearchParams({ kind: input.kind });
  if (input.filename) query.set('filename', input.filename);
  if (input.caption) query.set('caption', input.caption);

  const file = new File(input.uri);
  const result = await file.upload(
    `${api.baseUrl}/api/v1/files/uploads?${query.toString()}`,
    {
      uploadType: UploadType.BINARY_CONTENT,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': input.mimeType,
      },
    },
  );

  // The native uploader does not run through the client's 401 handling, so
  // the one retry after a rotation has to be done here.
  if (result.status === 401 && !retried) {
    const refreshed = await api.refresh();
    if (refreshed) return uploadFile(input, true);
  }

  if (result.status >= 400) {
    let body: { error?: { code: string; message: string } } = {};
    try {
      body = JSON.parse(result.body) as typeof body;
    } catch {
      // Non-JSON error body: the status alone still produces a usable message.
    }
    throw new ApiError(result.status, body);
  }

  return JSON.parse(result.body) as UploadedFile;
}

/**
 * Hands a server-generated PDF to the OS.
 *
 * The URL is already signed and expiring, so no bearer token travels with it
 * — which is exactly what makes it safe to pass to the share sheet, where it
 * may end up in another app entirely.
 *
 * Sharing rather than opening: from the share sheet the same document can be
 * saved to Files, printed, or sent to the customer on WhatsApp. Thermal
 * printing is not attempted here — see `printing.ts`.
 */
export async function shareDocument(
  pathOrUrl: string,
  suggestedName = 'document.pdf',
): Promise<void> {
  const url = api.absoluteUrl(pathOrUrl);

  if (!(await Sharing.isAvailableAsync())) {
    await WebBrowser.openBrowserAsync(url);
    return;
  }

  const target = new File(new Directory(Paths.cache), safeFilename(suggestedName));
  if (target.exists) target.delete();

  const downloaded = await File.downloadFileAsync(url, target, { idempotent: true });
  await Sharing.shareAsync(downloaded.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: suggestedName,
  });
}

/** Opens a URL in an in-app browser tab, keeping the app in the background. */
export async function openInAppBrowser(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}
