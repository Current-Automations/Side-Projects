/**
 * lib/db/corrections.ts
 *
 * Query helpers for the corrections table.
 *
 * The transactional insert (correction + training_example) is implemented via
 * a Postgres RPC call to `insert_correction_with_training`. If the RPC is not
 * available, this module falls back to sequential inserts with manual rollback.
 */

import type { CardIdentification } from '@/lib/types';
import { createServerClient } from './client';

// ---------------------------------------------------------------------------
// insertCorrection
// ---------------------------------------------------------------------------

export interface InsertCorrectionInput {
  scan_id: string;
  user_id: string;
  corrected_labels: CardIdentification;
}

/**
 * Inserts a user correction into the `corrections` table AND inserts a
 * corresponding row into `training_examples` with source 'user_correction'.
 *
 * Both writes happen as a single atomic operation via the Postgres RPC function
 * `insert_correction_with_training`. If the RPC is unavailable, a sequential
 * fallback is used: the training_example insert is attempted first, and if it
 * fails the corrections insert is skipped (manual rollback via ordering).
 *
 * If training_example insert fails in fallback mode, the correction is NOT
 * persisted — callers receive the error rather than a partial write.
 */
export async function insertCorrection(
  correction: InsertCorrectionInput
): Promise<void> {
  const client = createServerClient();

  // First, retrieve the image_hash and current generation from the scan log
  // so we can populate the training_example correctly.
  const { data: scanRow, error: scanError } = await client
    .from('scan_logs')
    .select('image_hash, card_id')
    .eq('id', correction.scan_id)
    .maybeSingle();

  if (scanError) {
    throw new Error(`insertCorrection (scan lookup): ${scanError.message}`);
  }

  // Determine the current generation from the active training run (default 0)
  const { data: activeRun } = await client
    .from('training_runs')
    .select('generation')
    .eq('is_active', true)
    .maybeSingle();

  const generation: number = activeRun?.generation ?? 0;
  const imageHash: string = scanRow?.image_hash ?? '';

  // ---------------------------------------------------------------------------
  // Attempt RPC transactional insert first
  // ---------------------------------------------------------------------------
  const { error: rpcError } = await client.rpc('insert_correction_with_training', {
    p_scan_id: correction.scan_id,
    p_user_id: correction.user_id,
    p_corrected_labels: correction.corrected_labels as unknown,
    p_image_hash: imageHash,
    p_generation: generation,
  });

  if (!rpcError) {
    // RPC succeeded — mark the scan as corrected
    await client
      .from('scan_logs')
      .update({ was_corrected: true, correction_source: 'user' })
      .eq('id', correction.scan_id);
    return;
  }

  // RPC not available or failed — fall back to sequential inserts.
  // Insert training_example FIRST so that if it fails, corrections stays clean.
  const { error: trainingError } = await client.from('training_examples').insert({
    image_hash: imageHash,
    correct_labels: correction.corrected_labels as unknown,
    source: 'user_correction',
    generation,
  });

  if (trainingError) {
    // Training insert failed — do NOT write the correction row (manual rollback)
    throw new Error(
      `insertCorrection (training_example fallback): ${trainingError.message}. ` +
        'Correction was NOT saved to preserve consistency.'
    );
  }

  // Training example succeeded — now insert the correction row
  const { error: correctionError } = await client.from('corrections').insert({
    scan_id: correction.scan_id,
    user_id: correction.user_id,
    corrected_labels: correction.corrected_labels as unknown,
  });

  if (correctionError) {
    // Correction insert failed after training_example was written.
    // This is a partial write — log it clearly but still throw so callers know.
    throw new Error(
      `insertCorrection (corrections fallback): ${correctionError.message}. ` +
        'WARNING: training_example was written but corrections row was not.'
    );
  }

  // Mark the original scan as corrected
  await client
    .from('scan_logs')
    .update({ was_corrected: true, correction_source: 'user' })
    .eq('id', correction.scan_id);
}
