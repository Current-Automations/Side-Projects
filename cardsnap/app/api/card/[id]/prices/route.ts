/**
 * app/api/card/[id]/prices/route.ts
 *
 * GET /api/card/[id]/prices — price refresh for a known card.
 *
 * Looks up the card by ID, delegates to getPriceWithCache (cache-first, 4hr TTL),
 * and returns the pricing result. No auth required — prices are public data.
 */

import { getCardById, generateFingerprint } from '@/lib/db';
import { buildQuery, getPriceWithCache } from '@/lib/pricing';
import { ApiErrorCode } from '@/lib/types/api';
import type { ApiErrorCodeValue } from '@/lib/types/api';
import type { PriceRefreshResponse } from '@/lib/types/api';

function errorResponse(error: string, code: ApiErrorCodeValue, status: number): Response {
  return Response.json({ success: false, error, code }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  const cardResult = await getCardById(id);
  if (!cardResult.success) {
    // Supabase returns an error when .single() finds no row
    return errorResponse('NOT_FOUND', ApiErrorCode.NOT_FOUND, 404);
  }

  const card = cardResult.data;

  const fingerprint = generateFingerprint({
    player_name: card.player_name,
    year: card.year,
    manufacturer: card.manufacturer,
    set_name: card.set_name,
    parallel: card.parallel,
  });

  // buildQuery expects CardIdentification — map card row fields to that shape
  const query = buildQuery({
    sport: card.sport as Parameters<typeof buildQuery>[0]['sport'],
    player_name: card.player_name,
    year: card.year,
    manufacturer: card.manufacturer as Parameters<typeof buildQuery>[0]['manufacturer'],
    product_line: card.set_name,
    parallel_name: card.parallel || 'Base',
    is_graded: false,
    confidence: 1,
    parallel_confidence: 1,
    needs_confirmation: false,
  });

  const priceResult = await getPriceWithCache(query, fingerprint);
  if (!priceResult.success) {
    return errorResponse(priceResult.error, ApiErrorCode.DB_ERROR, 502);
  }

  const response: PriceRefreshResponse = {
    success: true,
    data: { pricing: priceResult.data.pricing },
  };

  return Response.json(response);
}
