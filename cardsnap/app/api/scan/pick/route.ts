/**
 * app/api/scan/pick/route.ts
 *
 * POST /api/scan/pick — the picker's answer for a scan that matched several
 * printings. card_id is the printing he tapped, or null for Wrong.
 *
 * The pick is the label: scan_logs keeps the model's text read (ai_response)
 * and gets the chosen card in final_card_id. The frame is never stored (Whatnot
 * terms), only its hash, as on every scan.
 *
 * SECURITY — user_id from the body is the same stopgap as /api/scan.
 * Tracked in .scratch/scan-endpoint/issues/01-scan-userid-from-session.md
 */

import { z } from 'zod';
import { generateFingerprint } from '@/lib/db';
import { getServerClient } from '@/lib/db/server-client';
import { getCatalogCardById, getSetName } from '@/lib/catalog';
import { getPriceWithCache } from '@/lib/pricing';
import { catalogSnapshotPrice } from '@/lib/pricing/catalog-snapshot';
import { ApiErrorCode } from '@/lib/types/api';
import type { ApiErrorCodeValue } from '@/lib/types/api';
import { CardIdentificationSchema } from '@/lib/types/domain';

const PickSchema = z.object({
  scan_id: z.string().uuid(),
  user_id: z.string().uuid(),
  card_id: z.string().min(1).nullable(),
});

function errorResponse(error: string, code: ApiErrorCodeValue, status: number): Response {
  return Response.json({ success: false, error, code }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', ApiErrorCode.VALIDATION_ERROR, 400);
  }
  const parsed = PickSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues.map((i) => i.message).join('; '), ApiErrorCode.VALIDATION_ERROR, 400);
  }
  const { scan_id, user_id, card_id } = parsed.data;

  const db = getServerClient();
  const { data: scanRow, error: scanError } = await db
    .from('scan_logs')
    .select('id, user_id, card_id, ai_response')
    .eq('id', scan_id)
    .maybeSingle();
  if (scanError) return errorResponse(`DB error: ${scanError.message}`, ApiErrorCode.DB_ERROR, 500);
  if (!scanRow) return errorResponse('Scan not found', ApiErrorCode.NOT_FOUND, 404);
  if (scanRow.user_id !== user_id) return errorResponse('Unauthorized', ApiErrorCode.UNAUTHORIZED, 403);

  if (card_id === null) {
    const { error } = await db
      .from('scan_logs')
      .update({ final_card_id: null, was_corrected: true, correction_source: 'pick_wrong' })
      .eq('id', scan_id);
    if (error) return errorResponse(`DB error: ${error.message}`, ApiErrorCode.DB_ERROR, 500);
    return Response.json({ success: true, data: { pricing: null } });
  }

  const found = await getCatalogCardById(card_id);
  if (!found.success) return errorResponse(found.error, ApiErrorCode.DB_ERROR, 500);
  const card = found.data;
  if (!card) return errorResponse('Card not in catalog', ApiErrorCode.NOT_FOUND, 404);

  const read = CardIdentificationSchema.safeParse(scanRow.ai_response);
  const finish = read.success ? read.data.finish : 'normal';
  const isGraded = read.success ? read.data.is_graded : false;
  const setName = await getSetName(card.set_id);

  const fingerprint = generateFingerprint({
    card_name: card.name,
    set_id: card.set_id,
    card_number: card.local_id,
    finish,
    grade_company: read.success ? (read.data.grade_company ?? null) : null,
    grade_value: read.success ? (read.data.grade_value ?? null) : null,
  });
  const query = [`"${card.name}"`, setName && `"${setName}"`, finish !== 'normal' && finish.replace('_', ' ')]
    .filter(Boolean)
    .join(' ');
  const priced = await getPriceWithCache(query, fingerprint, {
    card_name: card.name,
    set_name: setName ?? undefined,
    card_number: card.local_id,
    tcgdex_id: card.id,
    finish,
    is_graded: isGraded,
    grade_company: read.success ? read.data.grade_company : undefined,
    grade_value: read.success ? read.data.grade_value : undefined,
  });
  if (!priced.success) console.warn(`[pick] pricing unavailable: ${priced.error}`);
  const snapshot = priced.success ? null : catalogSnapshotPrice(card, finish);
  // The saved snapshot only has raw prices; on a slab, say so rather than pass it off as the grade's.
  const pricing = priced.success
    ? priced.data.pricing
    : snapshot && isGraded
      ? { ...snapshot, attribution: `${snapshot.attribution}, raw price, grade not priced` }
      : snapshot;

  const { error } = await db
    .from('scan_logs')
    .update({
      final_card_id: card.id,
      was_corrected: scanRow.card_id !== card.id,
      correction_source: 'pick',
      price_at_scan: pricing?.avg_sold_price ?? null,
    })
    .eq('id', scan_id);
  if (error) return errorResponse(`DB error: ${error.message}`, ApiErrorCode.DB_ERROR, 500);

  return Response.json({ success: true, data: { pricing } });
}
