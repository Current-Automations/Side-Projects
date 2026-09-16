/**
 * lib/pricing/index.ts
 *
 * Public API for the pricing layer.
 *
 * getPriceWithCache() is the single entry point used by route handlers:
 *   1. Check price_cache (4hr TTL) — return immediately on hit.
 *   2. On miss: fetch the previous avg for trend, call the active provider,
 *      write the result to cache, compute the trend, return.
 *
 * Graceful degradation: pricing failures return { success: false } — callers
 * should still return the card identification rather than failing the scan.
 *
 * Provider chain (2026-09-14 comping decision): try tcgapi.net's sold comps
 * first, then pokemonpricetracker.com (also has graded PSA values), and fall
 * back to eBay Browse asking prices only if both fail. The first two are
 * currently stubs (see their file headers) — until wired up, this chain
 * always falls through to ebay-browse, which itself throws AUTH_FAILED
 * without EBAY_APP_ID (intentionally unset). Pricing failure is non-fatal:
 * getPriceWithCache's caller returns pricing: null and keeps going.
 */

import { getCachedPrice, setCachedPrice, getPreviousAvgPrice } from '@/lib/db';
import { tcgapiCompsProvider } from './tcgapi-comps';
import { pokemonPriceTrackerProvider } from './pokemonpricetracker';
import { ebayBrowseProvider } from './ebay-browse';
import { PricingError } from '@/lib/types/pricing';
import type { PricingProvider } from './provider';
import type { PricingResult } from '@/lib/types/domain';
import type { DbResult } from '@/lib/types/db';
import type { PriceCache } from '@/lib/types/db';

export { buildQuery } from './ebay-browse';

export type PriceTrend = 'up' | 'down' | 'stable' | 'new';

export interface PriceWithCacheResult {
  pricing: PricingResult;
  cacheHit: boolean;
  trend: PriceTrend;
}

const PROVIDER_CHAIN: PricingProvider[] = [
  tcgapiCompsProvider,
  pokemonPriceTrackerProvider,
  ebayBrowseProvider,
];

/** Tries each provider in PROVIDER_CHAIN, returning the first success. Throws the last error if all fail. */
async function searchWithFallback(query: string): Promise<PricingResult> {
  let lastErr: unknown;
  for (const provider of PROVIDER_CHAIN) {
    try {
      return await provider.searchSoldListings(query);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[pricing] provider ${provider.source} failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All pricing providers failed');
}

function computeTrend(current: number, previous: number | null): PriceTrend {
  if (previous === null) return 'new';
  const delta = (current - previous) / previous;
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'stable';
}

function priceCacheToResult(row: PriceCache): PricingResult {
  return {
    avg_sold_price: row.avg_sold_price ?? 0,
    last_10_sales: (row.last_10_sales ?? []).map((sale) => ({
      price: sale.price,
      date: sale.date,
      title: sale.title,
      condition: sale.condition,
    })),
    sample_size: (row.last_10_sales ?? []).length,
    fetched_at: row.fetched_at,
    // price_cache doesn't record which provider produced the row, so this is
    // deliberately provider-neutral rather than falsely naming one.
    attribution: 'Prices from cached comp data',
  };
}

/**
 * Returns pricing for the given fingerprint, reading from cache when possible.
 * The fingerprint must be pre-computed by the caller (match.ts already does this).
 * The query is built from card fields inside this function to keep concerns separated.
 */
export async function getPriceWithCache(
  query: string,
  fingerprint: string
): Promise<DbResult<PriceWithCacheResult>> {
  try {
    // 1. Cache hit?
    const cached = await getCachedPrice(fingerprint);
    if (!cached.success) {
      return { success: false, error: `pricing (cache read): ${cached.error}` };
    }

    if (cached.data) {
      const pricing = priceCacheToResult(cached.data);
      return {
        success: true,
        data: {
          pricing,
          cacheHit: true,
          trend: 'stable',
        },
      };
    }

    // 2. Cache miss — grab previous avg for trend before overwriting.
    const prevResult = await getPreviousAvgPrice(fingerprint);
    const previousAvg = prevResult.success ? prevResult.data : null;

    // 3. Fetch from the provider chain.
    const pricing = await searchWithFallback(query);

    // 4. Write to cache. Domain Sale has no currency; db Sale requires it — default USD.
    const dbSales = pricing.last_10_sales.map((s) => ({
      price: s.price,
      currency: 'USD',
      date: s.date,
      title: s.title,
      condition: s.condition,
    }));

    const saved = await setCachedPrice({
      fingerprint,
      avgSoldPrice: pricing.avg_sold_price,
      last10Sales: dbSales,
    });
    if (!saved.success) {
      // Cache write failure is non-fatal — return the fresh data anyway.
      console.warn(`[pricing] cache write failed: ${saved.error}`);
    }

    const trend = computeTrend(pricing.avg_sold_price, previousAvg);

    return {
      success: true,
      data: { pricing, cacheHit: false, trend },
    };
  } catch (err) {
    const message =
      err instanceof PricingError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Unknown pricing error';
    return { success: false, error: message };
  }
}
