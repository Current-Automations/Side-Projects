/**
 * app/api/scan/correct/route.ts
 *
 * POST /api/scan/correct — user correction endpoint.
 *
 * When GPT-4o misidentifies a card, the user submits the corrected fields.
 * This endpoint:
 *   1. Validates the correction payload.
 *   2. Verifies the scan belongs to the requesting user (ownership check).
 *   3. Persists the correction + training_example via insertCorrection().
 *   4. Re-fetches prices using the corrected card fingerprint.
 *   5. Returns fresh pricing so the UI can update immediately.
 *
 * SECURITY — userId from request body is a stopgap identical to the scan
 * endpoint. Replace with session user before any non-local deploy.
 * Tracked: .scratch/scan-endpoint/issues/01-scan-userid-from-session.md
 */

import { z } from 'zod';
import { generateFingerprint, insertCorrection } from '@/lib/db';
import { buildQuery, getPriceWithCache } from '@/lib/pricing';
import { ApiErrorCode } from '@/lib/types/api';
import type { ApiErrorCodeValue } from '@/lib/types/api';
import { CorrectionSchema } from '@/lib/types/domain';
import { getServerClient } from '@/lib/db/server-client';

// Extend CorrectionSchema with the stopgap userId field.
const CorrectionRouteSchema = CorrectionSchema.extend({
  user_id: z.string().uuid('user_id must be a valid UUID'),
});

function errorResponse(error: string, code: ApiErrorCodeValue, status: number): Response {
  return Response.json({ success: false, error, code }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Parse + validate.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const parsed = CorrectionRouteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return errorResponse(message, ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const { scan_id, user_id, corrected_card } = parsed.data;

  // 2. Ownership check — the scan must belong to this user.
  const db = getServerClient();
  const { data: scanRow, error: scanError } = await db
    .from('scan_logs')
    .select('id, user_id')
    .eq('id', scan_id)
    .maybeSingle();

  if (scanError) {
    return errorResponse(`DB error: ${scanError.message}`, ApiErrorCode.DB_ERROR, 500);
  }
  if (!scanRow) {
    return errorResponse('Scan not found', ApiErrorCode.NOT_FOUND, 404);
  }
  if (scanRow.user_id !== user_id) {
    return errorResponse('Unauthorized', ApiErrorCode.UNAUTHORIZED, 403);
  }

  // 3. Build a complete CardIdentification from the partial correction.
  // Fill required fields from the schema defaults where omitted.
  const correctedCard = {
    sport: corrected_card.sport ?? 'NFL',
    player_name: corrected_card.player_name,
    year: corrected_card.year,
    manufacturer: corrected_card.manufacturer,
    product_line: corrected_card.product_line,
    set_variant: corrected_card.set_variant,
    card_number: corrected_card.card_number,
    parallel_name: corrected_card.parallel_name ?? 'Base',
    serial_number: corrected_card.serial_number,
    is_graded: corrected_card.is_graded ?? false,
    grade_company: corrected_card.grade_company,
    grade_value: corrected_card.grade_value,
    bgs_black_label: corrected_card.bgs_black_label,
    confidence: 1,
    parallel_confidence: 1,
    needs_confirmation: false,
  } as const;

  // 4. Persist correction + training_example atomically.
  try {
    await insertCorrection({
      scan_id,
      user_id,
      corrected_labels: correctedCard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(`Failed to save correction: ${message}`, ApiErrorCode.DB_ERROR, 500);
  }

  // 5. Re-fetch pricing for the corrected card.
  const fingerprint = generateFingerprint({
    player_name: correctedCard.player_name,
    year: correctedCard.year,
    manufacturer: correctedCard.manufacturer,
    set_name: correctedCard.product_line,
    parallel: correctedCard.parallel_name,
    grade_company: correctedCard.grade_company ?? null,
    grade_value: correctedCard.grade_value ?? null,
  });

  const query = buildQuery(correctedCard);
  const priceResult = await getPriceWithCache(query, fingerprint);
  if (!priceResult.success) {
    console.warn(`[correct] pricing unavailable after correction: ${priceResult.error}`);
  }

  return Response.json({
    success: true,
    data: {
      pricing: priceResult.success ? priceResult.data.pricing : null,
      trend: priceResult.success ? priceResult.data.trend : null,
    },
  });
}
