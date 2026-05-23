/**
 * lib/db/scans.ts
 *
 * Query helpers for the scan_logs table.
 */

import type { ScanResult, ApiResponse } from '@/lib/types';
import { ApiErrorCode } from '@/lib/types';
import { createServerClient } from './client';

// ---------------------------------------------------------------------------
// writeScanResult
// ---------------------------------------------------------------------------

/**
 * Writes a completed scan result to the scan_logs table.
 *
 * IMPORTANT: ScanResult (from lib/types) must NOT contain any field named
 * `image`, `screenshot`, `base64`, or `imageData`. The type contract at the
 * domain layer guarantees this — raw screenshot data is never stored, only
 * the derived scan result. This function enforces that implicitly by only
 * mapping the fields below.
 */
export async function writeScanResult(
  result: ScanResult & {
    user_id?: string;
    image_hash?: string;
  }
): Promise<void> {
  const client = createServerClient();

  const { error } = await client.from('scan_logs').insert({
    user_id: result.user_id ?? null,
    image_hash: result.image_hash ?? null,
    ai_response: result.card as unknown,
    was_corrected: false,
    correction_source: null,
  });

  if (error) {
    throw new Error(`writeScanResult: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// getScanById
// ---------------------------------------------------------------------------

/**
 * Retrieves a scan log row by id, scoped to the owning user.
 *
 * Returns { success: false, error: 'NOT_FOUND' } when the scan does not exist
 * or does not belong to the given userId — callers should not be able to
 * distinguish between "does not exist" and "belongs to another user".
 */
export async function getScanById(
  scanId: string,
  userId: string
): Promise<ApiResponse<ScanResult>> {
  const client = createServerClient();

  const { data, error } = await client
    .from('scan_logs')
    .select('*')
    .eq('id', scanId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: ApiErrorCode.DB_ERROR };
  }

  if (data === null) {
    return { success: false, error: 'Scan not found', code: ApiErrorCode.NOT_FOUND };
  }

  // The full ScanResult shape (with pricing, card, etc.) cannot be reconstructed
  // from the scan_logs row alone — a full reconstruction requires joining pricing.
  // Cast via unknown since the caller understands the partial nature.
  const scanResult = data as unknown as ScanResult;

  return { success: true, data: scanResult };
}
