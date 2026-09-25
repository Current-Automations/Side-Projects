/**
 * app/api/card/[id]/prices/route.ts
 *
 * GET /api/card/[id]/prices — price refresh for a known catalog card.
 *
 * Looks up the card by catalog_cards id, delegates to getPriceWithCache
 * (cache-first, 4hr TTL), and returns the pricing result. No auth required —
 * prices are public data.
 */

import { getCatalogCardById } from '@/lib/catalog';
import { generateFingerprint } from '@/lib/db';
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

  const cardResult = await getCatalogCardById(id);
  if (!cardResult.success || !cardResult.data) {
    return errorResponse('NOT_FOUND', ApiErrorCode.NOT_FOUND, 404);
  }

  const card = cardResult.data;

  const fingerprint = generateFingerprint({
    card_name: card.name,
    set_id: card.set_id,
    card_number: card.local_id,
    finish: 'normal',
  });

  // buildQuery expects CardIdentification — map catalog row fields to that shape.
  // finish defaults to 'normal': catalog_cards is one row per collector number,
  // not per finish, so this endpoint has no finish to pass without a caller-supplied one.
  const query = buildQuery({
    card_name: card.name,
    set_name: undefined,
    card_number: card.local_id,
    finish: 'normal',
    is_graded: false,
    confidence: 1,
    finish_confidence: 1,
    needs_confirmation: false,
  });

  const priceResult = await getPriceWithCache(query, fingerprint, {
    card_name: card.name,
    card_number: card.local_id,
    tcgdex_id: card.id,
    finish: 'normal',
    is_graded: false,
  });
  if (!priceResult.success) {
    return errorResponse(priceResult.error, ApiErrorCode.DB_ERROR, 502);
  }

  const response: PriceRefreshResponse = {
    success: true,
    data: { pricing: priceResult.data.pricing },
  };

  return Response.json(response);
}
