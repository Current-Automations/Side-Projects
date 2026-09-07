/**
 * lib/pricing/provider.ts
 *
 * PricingProvider interface. Every provider maps a search query to a fully-formed
 * PricingResult, including the required 'Prices from eBay' attribution literal.
 *
 * Current providers:
 *   ebay-browse    — eBay Browse API (active listings). Working, live.
 *   ebay-insights  — eBay Marketplace Insights API (true sold comps). Stubbed
 *                    until eBay grants access; swap via getActiveProvider() in index.ts.
 */

import type { PricingResult } from '@/lib/types/domain';

export interface PricingProvider {
  readonly source: 'ebay-browse' | 'ebay-insights';
  /**
   * Search for recent listings and return a PricingResult.
   * Throws PricingError on failure — callers catch and convert to DbResult.
   */
  searchSoldListings(query: string): Promise<PricingResult>;
}
