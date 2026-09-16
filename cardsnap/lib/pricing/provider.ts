/**
 * lib/pricing/provider.ts
 *
 * PricingProvider interface. Every provider maps a search query to a fully-formed
 * PricingResult, including a per-provider attribution string.
 *
 * Current providers, tried in this order by getActiveProvider() (lib/pricing/index.ts):
 *   tcgapi-comps        — tcgapi.net /v1/comps (eBay sold comps). STUB — see file header.
 *   pokemonpricetracker — pokemonpricetracker.com (TCGPlayer/eBay + graded PSA values). STUB — see file header.
 *   ebay-browse         — eBay Browse API (active listings, asking prices only). Working,
 *                         but EBAY_APP_ID is intentionally left unset (2026-09-14 decision:
 *                         eBay Browse/Insights approval isn't needed now that comping runs
 *                         through the two sources above) — throws AUTH_FAILED until set.
 */

import type { PricingResult } from '@/lib/types/domain';

export type PricingProviderSource = 'tcgapi-comps' | 'pokemonpricetracker' | 'ebay-browse' | 'ebay-insights';

export interface PricingProvider {
  readonly source: PricingProviderSource;
  /**
   * Search for recent listings and return a PricingResult.
   * Throws PricingError on failure — callers catch and convert to DbResult.
   */
  searchSoldListings(query: string): Promise<PricingResult>;
}
