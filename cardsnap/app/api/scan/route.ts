/**
 * app/api/scan/route.ts
 *
 * POST /api/scan — the core identification endpoint.
 *
 * Flow: validate body → enforce per-tier rate limit (server-side) → increment
 * the scan counter → identify the card with GPT-4o → match it against the
 * catalog/price cache → log the scan → return the identity + match. Pricing is
 * wired in Session 3, so `prices` is always null here.
 *
 * SECURITY — userId from the request body is TEMPORARY. Trusting a client-supplied
 * userId lets any caller spend another user's quota or attribute scans to them.
 * This MUST be replaced with the authenticated session user before any non-local
 * deployment. The "never trust the client" rule is only deferred, not waived.
 * Tracked in .scratch/scan-endpoint/issues/01-scan-userid-from-session.md
 *
 * PRIVACY — only a SHA-256 hash of the image is persisted (image_hash). The raw
 * screenshot/base64 is never written to the database.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { identify } from '@/lib/ai/identify';
import { match } from '@/lib/ai/match';
import { checkScanAllowed, incrementScanCount, createScanLog } from '@/lib/db';
import { ApiErrorCode } from '@/lib/types/api';
import { ScanRequestSchema } from '@/lib/types/api';
import type { ApiErrorCodeValue } from '@/lib/types/api';
import { buildQuery, getPriceWithCache } from '@/lib/pricing';

const MODEL_USED = 'gpt-4o';

// Body for this route = the shared image payload + a userId. userId is a stopgap
// until the authenticated session supplies it; see the SECURITY note above.
const ScanRouteRequestSchema = ScanRequestSchema.extend({
  userId: z.string().uuid('userId must be a valid user id'),
});

function errorResponse(error: string, code: ApiErrorCodeValue, status: number): Response {
  return Response.json({ success: false, error, code }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Parse + validate the request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Request body must be valid JSON', ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const parsed = ScanRouteRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    return errorResponse(message, ApiErrorCode.VALIDATION_ERROR, 400);
  }

  const { image, userId } = parsed.data;

  // 2. Enforce the daily scan limit server-side (per plan tier).
  const allowed = await checkScanAllowed(userId);
  if (!allowed.success) {
    return errorResponse(allowed.error, ApiErrorCode.DB_ERROR, 500);
  }
  if (!allowed.data.allowed) {
    return errorResponse(
      'Daily scan limit reached for your plan. Upgrade for more scans.',
      ApiErrorCode.RATE_LIMIT_EXCEEDED,
      429
    );
  }

  // 3. Identify the card with GPT-4o vision.
  const identification = await identify(image);
  if (!identification.success) {
    const code =
      identification.code === 'INVALID_IMAGE'
        ? ApiErrorCode.INVALID_IMAGE
        : ApiErrorCode.IDENTIFICATION_FAILED;
    const status = identification.code === 'INVALID_IMAGE' ? 400 : 502;
    return errorResponse(identification.error, code, status);
  }

  // 4. Identification succeeded — only now consume a scan from the user's quota.
  // Deliberately AFTER identify so a failed/declined scan doesn't cost the user
  // (small TOCTOU window vs. the limit check is acceptable pre-auth). Do not
  // move this before identify().
  const incremented = await incrementScanCount(userId);
  if (!incremented.success) {
    return errorResponse(incremented.error, ApiErrorCode.DB_ERROR, 500);
  }

  // 5. Match against the catalog + price cache.
  const matched = await match(identification.data);
  if (!matched.success) {
    return errorResponse(matched.error, ApiErrorCode.DB_ERROR, 500);
  }

  // 6. Fetch pricing (cache-first, 4hr TTL). Non-fatal on failure.
  const query = buildQuery(identification.data);
  const priceResult = await getPriceWithCache(query, matched.data.fingerprint);
  if (!priceResult.success) {
    console.warn(`[scan] pricing unavailable: ${priceResult.error}`);
  }
  const pricing = priceResult.success ? priceResult.data.pricing : null;
  const trend = priceResult.success ? priceResult.data.trend : null;
  const pricingCacheHit = priceResult.success ? priceResult.data.cacheHit : false;

  // 7. Log the scan. Persist only a hash of the image — never the raw screenshot.
  const imageHash = createHash('sha256').update(image).digest('hex');
  const logResult = await createScanLog({
    user_id: userId,
    image_hash: imageHash,
    ai_response: identification.data,
    model_used: MODEL_USED,
    card_id: matched.data.card?.id,
    cache_hit: pricingCacheHit,
    price_at_scan: pricing?.avg_sold_price,
  });
  if (!logResult.success) {
    return errorResponse(logResult.error, ApiErrorCode.DB_ERROR, 500);
  }

  // 8. Return identity + pricing.
  // remaining came from checkScanAllowed (pre-increment), so subtract this scan.
  const remainingScans =
    allowed.data.remaining === null ? null : Math.max(0, allowed.data.remaining - 1);

  return Response.json({
    success: true,
    data: {
      scan_id: logResult.data.id,
      card: identification.data,
      pricing,
      trend,
      cache_hit: pricingCacheHit,
      remaining_scans: remainingScans,
    },
  });
}
