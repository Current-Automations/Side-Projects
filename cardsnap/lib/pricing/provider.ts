/**
 * lib/pricing/provider.ts
 *
 * PricingProvider interface. Every provider maps a search query to a fully-formed
 * PricingResult, including a per-provider attribution string.
 *
 * Current providers, tried in this order by getActiveProvider() (lib/pricing/index.ts):
 *   tcgapi-comps        — tcgapi.net /v1/comps (eBay sold comps). STUB — see file header.
 *   pokemonpricetracker — pokemonpricetracker.com, TCGplayer market price for the exact printing. LIVE
 *                         since 2026-09-25 (POKEMONPRICETRACKER_API_KEY), 1 credit per known card.
 *   ebay-browse         — eBay Browse API (active listings, asking prices only). Working,
 *                         but EBAY_APP_ID is intentionally left unset (2026-09-14 decision:
 *                         eBay Browse/Insights approval isn't needed now that comping runs
 *                         through the two sources above) — throws AUTH_FAILED until set.
 */

import type { CardIdentification, PricingResult } from '@/lib/types/domain';

/** The identified card, for providers that look up an exact card rather than a free-text query. */
export interface PriceLookup {
  card_name: string;
  set_name?: string;
  card_number?: string;
  /** TCGdex id of the matched catalog card, e.g. "sv03-125". Exact lookup when present. */
  tcgdex_id?: string;
  finish: CardIdentification['finish'];
  is_graded: boolean;
}

export type PricingProviderSource = 'tcgapi-comps' | 'pokemonpricetracker' | 'ebay-browse' | 'ebay-insights';

export interface PricingProvider {
  readonly source: PricingProviderSource;
  /**
   * Search for recent listings and return a PricingResult.
   * Throws PricingError on failure — callers catch and convert to DbResult.
   */
  searchSoldListings(query: string, card?: PriceLookup): Promise<PricingResult>;
}
